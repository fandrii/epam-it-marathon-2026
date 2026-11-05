using Amazon.CognitoIdentityProvider.Model;
using APIHandler.Constants;
using APIHandler.Constants.Dishes;
using APIHandler.Constants.Orders;
using APIHandler.Entities;
using APIHandler.Exceptions;
using APIHandler.Mappers;
using APIHandler.Models.GuestSessions;
using APIHandler.Models.Orders;
using APIHandler.Repositories.Auth;
using APIHandler.Repositories.Dishes;
using APIHandler.Repositories.GroupReservations;
using APIHandler.Repositories.GuestSessions;
using APIHandler.Repositories.Orders;
using APIHandler.Repositories.Reservations;
using APIHandler.Repositories.Tables;
using System;
using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;
using System.Linq;
using System.Security.Cryptography;
using System.Threading.Tasks;
using APIHandler.Services.Notifications;

namespace APIHandler.Services.GuestSessions;

public class GuestSessionService(
    IGroupReservationRepository groupReservationRepository,
    IGuestSessionRepository guestSessionRepository,
    IDishRepository dishRepository,
    IOrderRepository orderRepository,
    IReservationRepository reservationRepository,
    IUserRepository userRepository,
    ITableRepository tableRepository) : IGuestSessionService
{
    public async Task<bool> IsAuthorizedAsync(string guestSessionToken, string guestSessionId)
    {
        string hash = Convert.ToBase64String(SHA256.HashData(Convert.FromBase64String(guestSessionToken)));
        GuestSession? guestSession = await guestSessionRepository.GetByTokenHash(hash);
        if (guestSession is null)
            return false;

        return guestSession.Id == guestSessionId;
    }

    public async Task<CreatGuestSessionResponse> CreateGuestSessionAsync(CreateGuestSessionRequest request)
    {
        GroupReservation group = await GetGroupReservationAndValidateAsync(request.GroupReservationId);

        Task<Reservation?> reservationTask = reservationRepository.GetReservationByIdAsync(group.ReservationId);
        Task<int> countTask = guestSessionRepository.CountByGroupReservationId(group.GroupReservationId);

        Reservation reservation = await reservationTask ?? throw new GroupReservationExpiredException($"Associated reservation for group '{request.GroupReservationId}' not found.");

        if (reservation.Status != ReservationStatus.Reserved)
        {
            throw new GuestSessionExpiredException($"This pre-order session has expired or is no longer active. Current reservation status: '{reservation.Status}'.");
        }

        int joinedGuestsCount = await countTask;

        if (joinedGuestsCount >= reservation.GuestCount)
            throw new GuestLimitExceededException($"Guest limit exceeded. Maximum capacity is {reservation.GuestCount}, but {joinedGuestsCount} guests have already joined.");

        byte[] tokenBytes = RandomNumberGenerator.GetBytes(32);

        var session = new GuestSession()
        {
            Id = Guid.NewGuid().ToString(),
            GuestName = request.GuestName,
            GroupReservationId = group.GroupReservationId,
            SessionTokenHash = Convert.ToBase64String(SHA256.HashData(tokenBytes)),
            Dishes = [],
        };

        await guestSessionRepository.SaveAsync(session);

        return new CreatGuestSessionResponse(session.Id, Convert.ToBase64String(tokenBytes));
    }

    public async Task<GuestMenuResponse> GetGuestMenuAsync(string guestSessionId)
    {
        var session = await guestSessionRepository.GetByGuestSessionId(guestSessionId)
            ?? throw new ValidationException($"Guest session '{guestSessionId}' not found.");

        await ValidateGroupReservationId(session.GroupReservationId);

        string locationId = await GetLocationIdForGroupAsync(session.GroupReservationId);
        var dishes = await dishRepository.GetDishesByLocationIdAsync(locationId);

        var dishesMapped = dishes
            .GroupBy(d => d.DishType)
            .ToDictionary(k => k.Key, GuestMenuDishMapper.Map);

        return new GuestMenuResponse(dishesMapped);
    }

    public async Task AddDishAsync(string guestSessionId, string dishId, int quantity)
    {
        if (quantity <= 0)
            throw new ValidationException($"Quantity ({quantity}) must be greater than zero.");

        GuestSession session = await GetGuestSessionAsync(guestSessionId);

        string locationId = await GetLocationIdForGroupAsync(session.GroupReservationId);
        var locationDishes = await dishRepository.GetDishesByLocationIdAsync(locationId);

        var dish = locationDishes.FirstOrDefault(d => d.Id == dishId)
            ?? throw new ValidationException($"Dish '{dishId}' does not exist or is not available at this location.");

        if (dish.State != DishState.Available)
            throw new DishIsNotAvailableException($"Dish '{dishId}' is currently unavailable. State: '{dish.State}'.");

        session.Dishes ??= [];

        var existingDish = session.Dishes.FirstOrDefault(d => d.DishId == dishId);

        if (existingDish != null)
        {
            existingDish.Quantity += quantity;
        }
        else
        {
            session.Dishes.Add(new OrderItem
            {
                DishId = dishId,
                Quantity = quantity,
                State = OrderItemState.Pending
            });
        }

        await guestSessionRepository.SaveAsync(session);
    }

    public async Task RemoveDishAsync(string guestSessionId, string dishId, int quantity)
    {
        if (quantity <= 0)
            throw new ValidationException("Quantity must be greater than zero.");

        GuestSession session = await GetGuestSessionAsync(guestSessionId);

        if (session.Dishes == null || session.Dishes.Count == 0)
            throw new DishNotFoundException($"Dish {dishId} not found in guest session.");

        var existingDish = session.Dishes.FirstOrDefault(d => d.DishId == dishId)
            ?? throw new DishNotFoundException($"Dish {dishId} not found in guest session.");

        existingDish.Quantity -= quantity;

        if (existingDish.Quantity <= 0)
        {
            session.Dishes.Remove(existingDish);
        }

        await guestSessionRepository.SaveAsync(session);
    }

    public async Task<GroupReservationStatusResponse> GetGroupReservationStatusAsync(string groupReservationId)
    {
        var group = await groupReservationRepository.GetGroupReservationByIdAsync(groupReservationId)
            ?? throw new GroupReservationNotFoundException();

        var reservation = await reservationRepository.GetReservationByIdAsync(group.ReservationId)
            ?? throw new InvalidOperationException("Associated reservation not found.");

        int currentParticipants = await GetCurrentParticipantCountAsync(groupReservationId);

        return new GroupReservationStatusResponse
        {
            CurrentParticipants = currentParticipants,
            MaxCapacity = reservation.GuestCount,
            Status = group.Status
        };
    }

    
    public async Task<GetAllSessionsResponse> DeleteGuestSessionAsync(string userId, string groupReservationId, string guestSessionId)
    {
        Reservation reservation = await ValidateReservationOwnerAsync(groupReservationId, userId);

        var session = await guestSessionRepository.GetByGuestSessionId(guestSessionId)
            ?? throw new GuestSessionNotFoundException($"Guest session with id {guestSessionId} not found.");

        if (session.GroupReservationId != groupReservationId)
        {
            throw new ValidationException("Guest session does not belong to this group reservation.");
        }

        if (session.IsOwnerSession)
        {
            throw new ValidationException("Owner sessions cannot be deleted.");
        }

        await guestSessionRepository.DeleteAsync(session);

        var sessions = await guestSessionRepository.GetAllByGroupReservationIdAsync(groupReservationId);
        var remainingSessions = sessions
            .Where(remainingSession => remainingSession.Id != guestSessionId)
            .ToList();
        return await BuildSessionsSnapshotAsync(remainingSessions, reservation);
    }

    public async Task<GetAllSessionsResponse> GetAllSessionsForOwnerAsync(string userId, string groupReservationId)
    {
        Reservation reservation = await ValidateReservationOwnerAsync(groupReservationId, userId);
        var sessions = await guestSessionRepository.GetAllByGroupReservationIdAsync(groupReservationId);

        return await BuildSessionsSnapshotAsync(sessions, reservation);
    }

    public async Task<GetOwnerGuestSessionIdResponse> GetOwnerGuestSessionIdAsync(string userId, string reservationId)
    {
        Reservation reservation = await reservationRepository.GetReservationByIdAsync(reservationId)
            ?? throw new ReservationNotFoundException($"Reservation {reservationId} was not found.");

        if (!string.Equals(reservation.CustomerId, userId, StringComparison.Ordinal))
        {
            throw new ActionForbiddenException("Only the reservation owner can retrieve the owner guest session.");
        }

        GroupReservation group = await groupReservationRepository.GetByReservationIdAsync(reservationId)
            ?? throw new GroupReservationNotFoundException();

        string deterministicSessionId = GetOwnerSessionId(group.GroupReservationId);
        GuestSession? ownerSession = await guestSessionRepository.GetByGuestSessionId(deterministicSessionId);
        if (ownerSession is not null &&
            ownerSession.IsOwnerSession &&
            string.Equals(ownerSession.OwnerUserId, userId, StringComparison.Ordinal))
        {
            return new GetOwnerGuestSessionIdResponse(ownerSession.Id, group.GroupReservationId);
        }

        var sessions = await guestSessionRepository.GetAllByGroupReservationIdAsync(group.GroupReservationId);
        ownerSession = sessions.FirstOrDefault(session =>
            session.IsOwnerSession &&
            string.Equals(session.OwnerUserId, userId, StringComparison.Ordinal));

        return ownerSession is not null
            ? new GetOwnerGuestSessionIdResponse(ownerSession.Id, group.GroupReservationId)
            : throw new GuestSessionNotFoundException("Owner guest session was not found.");
    }

    public async Task<List<ConsolidatedOrderItemResponse>> SubmitGroupPreOrderAsync(
        string userId,
        string groupReservationId,
        string reservationId)
    {
        Reservation reservation = await reservationRepository.GetReservationByIdAsync(reservationId)
            ?? throw new ReservationNotFoundException($"Reservation {reservationId} was not found.");

        GroupReservation group = await groupReservationRepository.GetGroupReservationByIdAsync(groupReservationId)
            ?? throw new GroupReservationNotFoundException();

        if (!string.Equals(group.ReservationId, reservationId, StringComparison.Ordinal))
        {
            throw new ValidationException("The reservation does not belong to this group reservation.");
        }

        if (!string.Equals(reservation.CustomerId, userId, StringComparison.Ordinal))
        {
            throw new ActionForbiddenException("Only the reservation owner can submit the group pre-order.");
        }

        if (group.Status == GroupReservationStatus.Submitted)
        {
            throw new GroupReservationSubmittedException();
        }

        if (group.Status == GroupReservationStatus.Closed)
        {
            throw new GroupReservationExpiredException();
        }

        var sessions = await guestSessionRepository.GetAllByGroupReservationIdAsync(groupReservationId);
        var submittedGuestSessions = sessions
            .Where(session => session.IsSubmitted && !session.IsOwnerSession)
            .ToArray();

        if (submittedGuestSessions.Length == 0)
        {
            throw new ValidationException("There are no submitted guest sessions.");
        }

        var consolidatedItems = submittedGuestSessions
            .SelectMany(session => session.Dishes)
            .GroupBy(item => item.DishId, StringComparer.Ordinal)
            .Select(grouping => new ConsolidatedOrderItemResponse(
                grouping.Key,
                grouping.Sum(item => item.Quantity)))
            .OrderBy(item => item.DishId, StringComparer.Ordinal)
            .ToList();

        if (consolidatedItems.Count == 0)
        {
            throw new ValidationException("Submitted guest sessions contain no dishes.");
        }

        Order order = await orderRepository.GetOrderByReservationIdAsync(reservationId)
            ?? throw new ValidationException("Order was not found for the reservation.");

        if (!string.Equals(order.ReservationId, reservationId, StringComparison.Ordinal))
        {
            throw new ValidationException("The order does not belong to this reservation.");
        }

        var mergedOrderItems = order.Dishes
            .GroupBy(item => item.DishId, StringComparer.Ordinal)
            .ToDictionary(
                grouping => grouping.Key,
                grouping => new OrderItem
                {
                    DishId = grouping.Key,
                    Quantity = grouping.Sum(item => item.Quantity),
                    State = grouping.First().State
                },
                StringComparer.Ordinal);

        foreach (var consolidatedItem in consolidatedItems)
        {
            if (mergedOrderItems.TryGetValue(consolidatedItem.DishId, out var existingItem))
            {
                existingItem.Quantity += consolidatedItem.Quantity;
                existingItem.State = OrderItemState.Pending;
            }
            else
            {
                mergedOrderItems.Add(consolidatedItem.DishId, new OrderItem
                {
                    DishId = consolidatedItem.DishId,
                    Quantity = consolidatedItem.Quantity,
                    State = OrderItemState.Pending
                });
            }
        }

        order.Dishes = mergedOrderItems.Values
            .OrderBy(item => item.DishId, StringComparer.Ordinal)
            .ToList();
        order.Status = OrderStatus.SubmittedByCustomer;
        group.Status = GroupReservationStatus.Submitted;

        try
        {
            await groupReservationRepository.SubmitOrderAtomicallyAsync(order, group);
        }
        catch (Amazon.DynamoDBv2.Model.TransactionCanceledException)
        {
            GroupReservation? currentGroup = await groupReservationRepository
                .GetGroupReservationByIdAsync(groupReservationId);
            if (currentGroup?.Status == GroupReservationStatus.Submitted)
            {
                throw new GroupReservationSubmittedException();
            }

            throw new ValidationException("The order or group reservation changed during submission. Please retry.");
        }

        return consolidatedItems;
    }

    private async Task<GetAllSessionsResponse> BuildSessionsSnapshotAsync(
        List<GuestSession> sessions,
        Reservation reservation)
    {
        string? ownerName = null;
        if (sessions.Any(session => session.IsOwnerSession))
        {
            string customerId = reservation.CustomerId
                ?? throw new InvalidOperationException("Reservation owner is missing.");
            var user = await userRepository.GetUserByIdAsync(customerId)
                ?? throw new InvalidOperationException("Reservation owner's user profile was not found.");
            ownerName = user.Attributes?
                .FirstOrDefault(attribute => attribute.Name == "given_name")?.Value;
            if (string.IsNullOrWhiteSpace(ownerName))
            {
                throw new InvalidOperationException("Reservation owner's given name was not found.");
            }
        }

        var dishIds = sessions
            .SelectMany(s => s.Dishes)
            .Select(s => s.DishId)
            .Distinct()
            .ToArray();

        IEnumerable<Dish> allDishes = dishIds.Length == 0
            ? []
            : await dishRepository.GetDishesByIdsAsync(dishIds);
        var dishesById = allDishes.ToDictionary(d => d.Id);

        var participants = new List<Participant>();

        foreach (var session in sessions)
        {
            var items = session.Dishes.Select(d => new OrderItemResponse
            {
                Dish = DishMapper.ToDishResponse(dishesById[d.DishId]),
                Quantity = d.Quantity
            }).ToArray();

            decimal total = items.Sum(i => i.Quantity * i.Dish.Price);
            string name = session.IsOwnerSession
                ? ownerName ?? throw new InvalidOperationException("Reservation owner's name is unavailable.")
                : session.GuestName;
            var participant = new Participant(
                session.Id,
                session.IsOwnerSession ? ParticipantType.Owner : ParticipantType.Guest,
                name,
                items,
                total,
                session.IsSubmitted);
            participants.Add(participant);
        }

        return new GetAllSessionsResponse(participants, participants.Sum(p => p.Total));
    }

    public async Task SubmitCartAsync(string guestSessionId)
    {
        GuestSession guestSession = await GetGuestSessionAsync(guestSessionId);

        if (!guestSession.Dishes.Any())
            throw new CartIsEmptyException();

        await ValidateDishesAsync(guestSession.Dishes);

        guestSession.IsSubmitted = true;
        await guestSessionRepository.SaveAsync(guestSession);
    }

    private async Task<GroupReservation> GetGroupReservationAndValidateAsync(string groupReservationId)
    {
        GroupReservation? group = await groupReservationRepository.GetGroupReservationByIdAsync(groupReservationId);
        ValidateGroupReservation(group);
        return group;
    }

    private async Task<int> GetCurrentParticipantCountAsync(string groupReservationId)
    {
        var sessions = await guestSessionRepository.GetAllByGroupReservationIdAsync(groupReservationId);

        // The owner session is always present for a group reservation, but capacity and participant totals
        // should count only actual guest sessions plus the owner itself.
        return sessions.Count(session => !session.IsOwnerSession) + 1;
    }

    private async Task ValidateGroupReservationId(string groupReservationId) => await GetGroupReservationAndValidateAsync(groupReservationId);

    private static void ValidateGroupReservation([NotNull] GroupReservation? group)
    {
        if (group is null)
            throw new GroupReservationNotFoundException();

        if (group.Status == GroupReservationStatus.Closed)
            throw new GroupReservationExpiredException();

        if (group.Status == GroupReservationStatus.Submitted)
            throw new GroupReservationSubmittedException();
    }

    private async Task<GuestSession> GetGuestSessionAsync(string sessionId)
    {
        var session = await guestSessionRepository.GetByGuestSessionId(sessionId)
            ?? throw new GuestSessionNotFoundException($"Guest session {sessionId} not found.");

        if (session.IsSubmitted)
            throw new GuestSessionSubmittedException();

        await ValidateGroupReservationId(session.GroupReservationId);

        return session;
    }

    private async Task ValidateDishesAsync(IEnumerable<OrderItem> orders)
    {
        IEnumerable<string> dishIds = orders.Select(o => o.DishId).ToArray();
        IEnumerable<Dish> dishes = await dishRepository.GetDishesByIdsAsync(dishIds);

        if (dishes.FirstOrDefault(d => d.State != DishState.Available) is Dish dish)
            throw new DishIsNotAvailableException($"The dish '{dish.Name}' ({dish.Id}) is not available.");
    }

    private async Task<string> GetLocationIdForGroupAsync(string groupReservationId)
    {
        var group = await groupReservationRepository.GetGroupReservationByIdAsync(groupReservationId)
            ?? throw new GroupReservationNotFoundException();

        var reservation = await reservationRepository.GetReservationByIdAsync(group.ReservationId)
            ?? throw new ReservationNotFoundException("Parent reservation not found.");

        var table = await tableRepository.GetTableAsync(reservation.TableId)
            ?? throw new ValidationException("Associated table not found.");

        return table.LocationId;
    }

    
    private async Task<Reservation> ValidateReservationOwnerAsync(string groupReservationId, string userId)
    {
        var group = await groupReservationRepository.GetGroupReservationByIdAsync(groupReservationId)
            ?? throw new GroupReservationNotFoundException();

        var reservation = await reservationRepository.GetReservationByIdAsync(group.ReservationId)
            ?? throw new ReservationNotFoundException("Parent reservation not found.");

        if (reservation.CustomerId != userId)
        {
            throw new ActionForbiddenException("Only the reservation owner can perform this action.");
        }

        return reservation;
    }

    public async Task CreateGroupOwnerSessionAsync(string userId, string groupReservationId)
    {
        string sessionId = GetOwnerSessionId(groupReservationId);
        GuestSession? existingSession = await guestSessionRepository.GetByGuestSessionId(sessionId);
        if (existingSession is not null)
        {
            if (existingSession.IsOwnerSession &&
                string.Equals(existingSession.OwnerUserId, userId, StringComparison.Ordinal))
            {
                return;
            }

            throw new InvalidOperationException("The deterministic Owner session ID is already in use.");
        }

        var session = new GuestSession()
        {
            Id = sessionId,
            GroupReservationId = groupReservationId,
            GuestName = "Owner",
            Dishes = [],
            IsOwnerSession = true,
            OwnerUserId = userId,
        };

        await guestSessionRepository.SaveAsync(session);
    }

    private static string GetOwnerSessionId(string groupReservationId) => $"owner-{groupReservationId}";

    public async Task<GetGuestSessionResponse> GetGuestSessionInfoAsync(string guestSessionId)
    {
        var session = await guestSessionRepository.GetByGuestSessionId(guestSessionId)
            ?? throw new GuestSessionNotFoundException("Guest session was not found.");

        var dishIds = session.Dishes
            .Select(s => s.DishId)
            .Distinct()
            .ToArray();

        var allDishes = await dishRepository.GetDishesByIdsAsync(dishIds);
        var dishesById = allDishes.ToDictionary(d => d.Id);

        var items = session.Dishes.Select(d => new OrderItemResponse
        {
            Dish = DishMapper.ToDishResponse(dishesById[d.DishId]),
            Quantity = d.Quantity
        }).ToArray();

        decimal total = items.Sum(i => i.Quantity * i.Dish.Price);

        string name = session.GuestName;
        if (session.IsOwnerSession)
        {
            var groupReservation = await groupReservationRepository.GetGroupReservationByIdAsync(session.GroupReservationId);
            var reservation = await reservationRepository.GetReservationByIdAsync(groupReservation!.ReservationId);
            var user = await userRepository.GetUserByIdAsync(reservation!.CustomerId!);
            name = user!.Attributes.First(a => a.Name == "given_name").Value;
        }

        return new GetGuestSessionResponse(name, items, total, session.IsSubmitted);
    }

}
