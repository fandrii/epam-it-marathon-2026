using Amazon.CognitoIdentityProvider.Model;
using APIHandler.Constants.Dishes;
using APIHandler.Constants.Orders;
using APIHandler.Entities;
using APIHandler.Exceptions;
using APIHandler.Models.GuestSessions;
using APIHandler.Repositories.Auth;
using APIHandler.Repositories.Dishes;
using APIHandler.Repositories.GroupReservations;
using APIHandler.Repositories.GuestSessions;
using APIHandler.Repositories.Orders;
using APIHandler.Repositories.Reservations;
using APIHandler.Repositories.Tables;
using APIHandler.Services.GuestSessions;
using AutoFixture.Xunit2;
using Moq;
using NPOI.POIFS.Storage;
using System.Security.Cryptography;
using System.Text;

namespace APIHandler.Tests.Services;

public class GuestSessionServiceTests
{
    private readonly Mock<IGuestSessionRepository> _mockGuestSessionRepository = new();
    private readonly Mock<IGroupReservationRepository> _mockGroupReservationRepository = new();
    private readonly Mock<IDishRepository> _mockDishRepository = new();
    private readonly Mock<IOrderRepository> _mockOrderRepository = new();
    private readonly Mock<IReservationRepository> _mockReservationRepository = new();
    private readonly Mock<IUserRepository> _mockUserRepository = new();
    private readonly Mock<ITableRepository> _mockTableRepository = new();
    private readonly GuestSessionService _guestSessionService;

    public GuestSessionServiceTests()
    {
        _guestSessionService = new GuestSessionService(
            _mockGroupReservationRepository.Object,
            _mockGuestSessionRepository.Object,
            _mockDishRepository.Object,
            _mockOrderRepository.Object,
            _mockReservationRepository.Object,
            _mockUserRepository.Object,
            _mockTableRepository.Object);
    }
    [Theory]
    [InlineAutoData(0)]
    [InlineAutoData(3)]
    public async Task CreateGuestSessionAsync_CorrectData_ReturnsSessionToken(
        int guestCount,
        CreateGuestSessionRequest request,
        GroupReservation groupReservation,
        Reservation parentReservation)
    {
        groupReservation.GroupReservationId = request.GroupReservationId;
        groupReservation.Status = GroupReservationStatus.Open;
        groupReservation.ReservationId = parentReservation.Id;

        parentReservation.GuestCount = 5;

        _mockGroupReservationRepository
            .Setup(r => r.GetGroupReservationByIdAsync(groupReservation.GroupReservationId))
            .ReturnsAsync(groupReservation);

        _mockReservationRepository
            .Setup(r => r.GetReservationByIdAsync(parentReservation.Id))
            .ReturnsAsync(parentReservation);

        _mockGuestSessionRepository
            .Setup(r => r.GetAllByGroupReservationIdAsync(groupReservation.GroupReservationId))
            .ReturnsAsync([]);

        GuestSession? session = null;
        _mockGuestSessionRepository
            .Setup(r => r.SaveAsync(It.IsAny<GuestSession>()))
            .Callback<GuestSession>(s => session = s);

        _mockGuestSessionRepository
            .Setup(r => r.CountByGroupReservationId(groupReservation.GroupReservationId))
            .ReturnsAsync(guestCount);

        var response = await _guestSessionService.CreateGuestSessionAsync(request);

        Assert.NotEmpty(response.SessionId);
        Assert.NotEmpty(response.SessionToken);
        Assert.NotNull(session);
        Assert.Equal(groupReservation.GroupReservationId, session.GroupReservationId);
        Assert.Equal(request.GuestName, session.GuestName);
        Assert.NotNull(session.SessionTokenHash);
        Assert.NotEmpty(session.SessionTokenHash);
    }

    [Theory]
    [AutoData]
    public async Task CreateGuestSessionAsync_InvalidGroupReservationId_ThrowsGroupReservationNotFoundException(CreateGuestSessionRequest request)
    {
        _mockGroupReservationRepository
            .Setup(r => r.GetGroupReservationByIdAsync(request.GroupReservationId))
            .ReturnsAsync((GroupReservation?)null);

        await Assert.ThrowsAsync<GroupReservationNotFoundException>(() => _guestSessionService.CreateGuestSessionAsync(request));
    }

    [Theory]
    [AutoData]
    public async Task CreateGuestSessionAsync_GroupReservationExpired_ThrowsGroupReservationExpiredException(CreateGuestSessionRequest request, GroupReservation groupReservation)
    {
        groupReservation.GroupReservationId = request.GroupReservationId;
        groupReservation.Status = GroupReservationStatus.Open;

        _mockGroupReservationRepository
            .Setup(r => r.GetGroupReservationByIdAsync(request.GroupReservationId))
            .ReturnsAsync(groupReservation);

        await Assert.ThrowsAsync<GroupReservationExpiredException>(() => _guestSessionService.CreateGuestSessionAsync(request));
    }

    [Theory]
    [AutoData]
    public async Task AddDishAsync_ShouldAddNewDish_WhenDishDoesNotExistInSession(GuestSession guestSession, GroupReservation groupReservation, Reservation parentReservation, Table table, Dish dish)
    {
        guestSession.Dishes = [];
        guestSession.GroupReservationId = groupReservation.GroupReservationId;
        groupReservation.Status = GroupReservationStatus.Open;

        groupReservation.ReservationId = parentReservation.Id;
        parentReservation.TableId = table.Id;
        dish.State = DishState.Available;
        int quantityToAdd = 2;

        _mockGuestSessionRepository.Setup(r => r.GetByGuestSessionId(guestSession.Id)).ReturnsAsync(guestSession);
        _mockGroupReservationRepository.Setup(r => r.GetGroupReservationByIdAsync(groupReservation.GroupReservationId)).ReturnsAsync(groupReservation);
        _mockReservationRepository.Setup(r => r.GetReservationByIdAsync(parentReservation.Id)).ReturnsAsync(parentReservation);
        _mockTableRepository.Setup(r => r.GetTableAsync(table.Id)).ReturnsAsync(table);
        _mockDishRepository.Setup(r => r.GetDishesByLocationIdAsync(table.LocationId)).ReturnsAsync([dish]);

        await _guestSessionService.AddDishAsync(guestSession.Id, dish.Id, quantityToAdd);

        Assert.Single(guestSession.Dishes);
        Assert.Equal(dish.Id, guestSession.Dishes[0].DishId);
        Assert.Equal(quantityToAdd, guestSession.Dishes[0].Quantity);
        Assert.Equal(OrderItemState.Pending, guestSession.Dishes[0].State);

        _mockGuestSessionRepository.Verify(r => r.SaveAsync(guestSession), Times.Once);
    }

    [Theory]
    [AutoData]
    public async Task AddDishAsync_ShouldIncreaseQuantity_WhenDishAlreadyExists(GuestSession guestSession, GroupReservation groupReservation, Reservation parentReservation, Table table, Dish dish)
    {
        int initialQuantity = 3;
        int quantityToAdd = 2;
        guestSession.Dishes = [new OrderItem { DishId = dish.Id, Quantity = initialQuantity, State = OrderItemState.Pending }];
        guestSession.GroupReservationId = groupReservation.GroupReservationId;
        groupReservation.Status = GroupReservationStatus.Open;

        groupReservation.ReservationId = parentReservation.Id;
        parentReservation.TableId = table.Id;
        dish.State = DishState.Available;

        _mockGuestSessionRepository.Setup(r => r.GetByGuestSessionId(guestSession.Id)).ReturnsAsync(guestSession);
        _mockGroupReservationRepository.Setup(r => r.GetGroupReservationByIdAsync(groupReservation.GroupReservationId)).ReturnsAsync(groupReservation);
        _mockReservationRepository.Setup(r => r.GetReservationByIdAsync(parentReservation.Id)).ReturnsAsync(parentReservation);
        _mockTableRepository.Setup(r => r.GetTableAsync(table.Id)).ReturnsAsync(table);
        _mockDishRepository.Setup(r => r.GetDishesByLocationIdAsync(table.LocationId)).ReturnsAsync([dish]);

        await _guestSessionService.AddDishAsync(guestSession.Id, dish.Id, quantityToAdd);

        Assert.Single(guestSession.Dishes);
        Assert.Equal(initialQuantity + quantityToAdd, guestSession.Dishes[0].Quantity);

        _mockGuestSessionRepository.Verify(r => r.SaveAsync(guestSession), Times.Once);
    }

    [Theory]
    [InlineAutoData(0)]
    [InlineAutoData(-1)]
    public async Task AddDishAsync_ShouldThrowValidationException_WhenQuantityIsZeroOrLess(int quantity, string guestSessionId, Dish dish)
    {
        dish.State = DishState.Available;

        _mockDishRepository
            .Setup(r => r.GetDishByIdAsync(dish.Id))
            .ReturnsAsync(dish);

        await Assert.ThrowsAsync<ValidationException>(() =>
            _guestSessionService.AddDishAsync(guestSessionId, dish.Id, quantity));
    }

    [Theory]
    [AutoData]
    public async Task AddDishAsync_ShouldThrowGuestSessionNotFoundException_WhenSessionNotFound(string guestSessionId, Dish dish)
    {
        dish.State = DishState.Available;

        _mockGuestSessionRepository
            .Setup(r => r.GetByGuestSessionId(guestSessionId))
            .ReturnsAsync((GuestSession?)null);

        _mockDishRepository
            .Setup(r => r.GetDishByIdAsync(dish.Id))
            .ReturnsAsync(dish);

        var exception = await Assert.ThrowsAsync<GuestSessionNotFoundException>(() =>
            _guestSessionService.AddDishAsync(guestSessionId, dish.Id, 2));
    }

    [Theory]
    [AutoData]
    public async Task AddDishAsync_ShouldThrowDishNotFound_WhenDishNotFound(GuestSession guestSession, GroupReservation groupReservation, Reservation parentReservation, Table table, string dishId)
    {
        guestSession.GroupReservationId = groupReservation.GroupReservationId;
        groupReservation.Status = GroupReservationStatus.Open;
        groupReservation.ReservationId = parentReservation.Id;
        parentReservation.TableId = table.Id;

        _mockGuestSessionRepository.Setup(r => r.GetByGuestSessionId(guestSession.Id)).ReturnsAsync(guestSession);
        _mockGroupReservationRepository.Setup(r => r.GetGroupReservationByIdAsync(groupReservation.GroupReservationId)).ReturnsAsync(groupReservation);
        _mockReservationRepository.Setup(r => r.GetReservationByIdAsync(parentReservation.Id)).ReturnsAsync(parentReservation);
        _mockTableRepository.Setup(r => r.GetTableAsync(table.Id)).ReturnsAsync(table);

        _mockDishRepository.Setup(r => r.GetDishesByLocationIdAsync(table.LocationId)).ReturnsAsync([]);

        var exception = await Assert.ThrowsAsync<ValidationException>(() =>
            _guestSessionService.AddDishAsync(guestSession.Id, dishId, quantity: 2));
    }

    [Theory]
    [AutoData]
    public async Task AddDishAsync_ShouldThrowDishNotAvailable_WhenDishIsNotAvailable(GuestSession guestSession, GroupReservation groupReservation, Reservation parentReservation, Table table, Dish dish)
    {
        dish.State = DishState.OutOfStock;
        guestSession.GroupReservationId = groupReservation.GroupReservationId;
        groupReservation.Status = GroupReservationStatus.Open;
        groupReservation.ReservationId = parentReservation.Id;
        parentReservation.TableId = table.Id;

        _mockGuestSessionRepository.Setup(r => r.GetByGuestSessionId(guestSession.Id)).ReturnsAsync(guestSession);
        _mockGroupReservationRepository.Setup(r => r.GetGroupReservationByIdAsync(groupReservation.GroupReservationId)).ReturnsAsync(groupReservation);
        _mockReservationRepository.Setup(r => r.GetReservationByIdAsync(parentReservation.Id)).ReturnsAsync(parentReservation);
        _mockTableRepository.Setup(r => r.GetTableAsync(table.Id)).ReturnsAsync(table);
        _mockDishRepository.Setup(r => r.GetDishesByLocationIdAsync(table.LocationId)).ReturnsAsync([dish]);

        var exception = await Assert.ThrowsAsync<DishIsNotAvailableException>(() =>
            _guestSessionService.AddDishAsync(guestSession.Id, dish.Id, quantity: 2));
    }

    [Theory]
    [InlineAutoData(GroupReservationStatus.Submitted, typeof(GroupReservationSubmittedException))]
    [InlineAutoData(GroupReservationStatus.Closed, typeof(GroupReservationExpiredException))]
    public async Task AddDishAsync_ShouldThrowGroupReservationExpired_WhenGroupStatusIsNotOpen(GroupReservationStatus status, Type exceptionType, GuestSession guestSession, GroupReservation groupReservation, Dish dish)
    {
        dish.State = DishState.Available;
        guestSession.GroupReservationId = groupReservation.GroupReservationId;
        groupReservation.Status = status;

        _mockGuestSessionRepository
            .Setup(r => r.GetByGuestSessionId(guestSession.Id))
            .ReturnsAsync(guestSession);

        _mockDishRepository
            .Setup(r => r.GetDishByIdAsync(dish.Id))
            .ReturnsAsync(dish);

        _mockGroupReservationRepository
            .Setup(r => r.GetGroupReservationByIdAsync(groupReservation.GroupReservationId))
            .ReturnsAsync(groupReservation);

        var exception = await Assert.ThrowsAsync(exceptionType, () =>
            _guestSessionService.AddDishAsync(guestSession.Id, dish.Id, quantity: 2));
    }

    [Theory]
    [AutoData]
    public async Task RemoveDishAsync_ShouldDecreaseQuantity_WhenQuantityIsGreaterThanAmountToRemove(GuestSession guestSession, GroupReservation groupReservation, string dishId)
    {
        int initialQuantity = 5;
        int quantityToRemove = 2;
        guestSession.Dishes =
        [
            new OrderItem { DishId = dishId, Quantity = initialQuantity, State = OrderItemState.Pending }
        ];
        guestSession.GroupReservationId = groupReservation.GroupReservationId;
        groupReservation.Status = GroupReservationStatus.Open;

        _mockGuestSessionRepository
            .Setup(r => r.GetByGuestSessionId(guestSession.Id))
            .ReturnsAsync(guestSession);


        _mockGroupReservationRepository
            .Setup(r => r.GetGroupReservationByIdAsync(groupReservation.GroupReservationId))
            .ReturnsAsync(groupReservation);

        await _guestSessionService.RemoveDishAsync(guestSession.Id, dishId, quantityToRemove);

        Assert.Single(guestSession.Dishes);
        Assert.Equal(initialQuantity - quantityToRemove, guestSession.Dishes[0].Quantity);

        _mockGuestSessionRepository.Verify(r => r.SaveAsync(guestSession), Times.Once);
    }

    [Theory]
    [AutoData]
    public async Task RemoveDishAsync_ShouldRemoveDishFromList_WhenQuantityToRemoveIsEqualOrGreater(GuestSession guestSession, GroupReservation groupReservation, string dishId)
    {
        int initialQuantity = 2;
        int quantityToRemove = 3;
        guestSession.Dishes =
        [
            new OrderItem { DishId = dishId, Quantity = initialQuantity, State = OrderItemState.Pending }
        ];
        guestSession.GroupReservationId = groupReservation.GroupReservationId;
        groupReservation.Status = GroupReservationStatus.Open;

        _mockGuestSessionRepository
            .Setup(r => r.GetByGuestSessionId(guestSession.Id))
            .ReturnsAsync(guestSession);

        _mockGroupReservationRepository
            .Setup(r => r.GetGroupReservationByIdAsync(groupReservation.GroupReservationId))
            .ReturnsAsync(groupReservation);

        await _guestSessionService.RemoveDishAsync(guestSession.Id, dishId, quantityToRemove);

        Assert.Empty(guestSession.Dishes);
        _mockGuestSessionRepository.Verify(r => r.SaveAsync(guestSession), Times.Once);
    }

    [Theory]
    [AutoData]
    public async Task RemoveDishAsync_ShouldThrowDishNotFoundException_WhenDishDoesNotExistInSession(GuestSession guestSession, GroupReservation groupReservation, string dishId)
    {
        guestSession.Dishes = [];
        guestSession.GroupReservationId = groupReservation.GroupReservationId;
        groupReservation.Status = GroupReservationStatus.Open;

        _mockGuestSessionRepository
            .Setup(r => r.GetByGuestSessionId(guestSession.Id))
            .ReturnsAsync(guestSession);

        _mockGroupReservationRepository
           .Setup(r => r.GetGroupReservationByIdAsync(groupReservation.GroupReservationId))
           .ReturnsAsync(groupReservation);

        var exception = await Assert.ThrowsAsync<DishNotFoundException>(() =>
            _guestSessionService.RemoveDishAsync(guestSession.Id, dishId, 2));

        Assert.Contains("not found in guest session", exception.Message);
    }

    [Theory]
    [AutoData]
    public async Task RemoveDishAsync_ShouldThrowValidationException_WhenQuantityIsZeroOrLess(string guestSessionId, string dishId)
    {
        await Assert.ThrowsAsync<ValidationException>(() =>
            _guestSessionService.RemoveDishAsync(guestSessionId, dishId, 0));

        await Assert.ThrowsAsync<ValidationException>(() =>
            _guestSessionService.RemoveDishAsync(guestSessionId, dishId, -5));
    }

    [Theory]
    [AutoData]
    public async Task RemoveDishAsync_ShouldThrowGuestSessionNotFoundException_WhenSessionNotFound(string guestSessionId, string dishId)
    {
        _mockGuestSessionRepository
            .Setup(r => r.GetByGuestSessionId(guestSessionId))
            .ReturnsAsync((GuestSession?)null);

        var exception = await Assert.ThrowsAsync<GuestSessionNotFoundException>(() =>
            _guestSessionService.RemoveDishAsync(guestSessionId, dishId, 2));
    }
    [Theory]
    [InlineAutoData(1, 0)]
    [InlineAutoData(1, 1)]
    [InlineAutoData(2, 1)]
    [InlineAutoData(2, 2)]
    public async Task CreateGuestSessionAsync_WhenCapacityReached_ThrowsGuestLimitExceededException(
        int reservationCapacity,
        int guestCount,
        CreateGuestSessionRequest request,
        GroupReservation groupReservation,
        Reservation parentReservation)
    {
        groupReservation.Status = GroupReservationStatus.Open;
        groupReservation.GroupReservationId = request.GroupReservationId;
        groupReservation.ReservationId = parentReservation.Id;

        parentReservation.GuestCount = reservationCapacity;

        _mockGroupReservationRepository
            .Setup(r => r.GetGroupReservationByIdAsync(groupReservation.GroupReservationId))
            .ReturnsAsync(groupReservation);

        _mockReservationRepository
            .Setup(r => r.GetReservationByIdAsync(parentReservation.Id))
            .ReturnsAsync(parentReservation);

        _mockGuestSessionRepository
            .Setup(r => r.CountByGroupReservationId(groupReservation.GroupReservationId))
            .ReturnsAsync(guestCount);

        var exception = await Assert.ThrowsAsync<GuestLimitExceededException>(() => _guestSessionService.CreateGuestSessionAsync(request));

        _mockGuestSessionRepository.Verify(r => r.SaveAsync(It.IsAny<GuestSession>()), Times.Never);
    }

    [Theory]
    [AutoData]
    public async Task CreateGuestSessionAsync_MissingParentReservation_ThrowsGroupReservationExpiredException(
        CreateGuestSessionRequest request,
        GroupReservation groupReservation)
    {
        groupReservation.GroupReservationId = request.GroupReservationId;
        groupReservation.Status = GroupReservationStatus.Open;

        _mockGroupReservationRepository
            .Setup(r => r.GetGroupReservationByIdAsync(groupReservation.GroupReservationId))
            .ReturnsAsync(groupReservation);

        _mockReservationRepository
            .Setup(r => r.GetReservationByIdAsync(groupReservation.ReservationId))
            .ReturnsAsync((Reservation?)null);

        var exception = await Assert.ThrowsAsync<GroupReservationExpiredException>(() => _guestSessionService.CreateGuestSessionAsync(request));
    }

    [Theory]
    [AutoData]
    public async Task IsAuthorizedAsync_ValidTokenAndId_ReturnsTrue(GuestSession guestSession, byte[] tokenBytes)
    {
        string tokenString = Convert.ToBase64String(tokenBytes);
        var hashString = Convert.ToBase64String(SHA256.HashData(tokenBytes));
        guestSession.SessionTokenHash = hashString;

        _mockGuestSessionRepository
            .Setup(r => r.GetByTokenHash(hashString))
            .ReturnsAsync(guestSession);

        bool result = await _guestSessionService.IsAuthorizedAsync(tokenString, guestSession.Id);

        Assert.True(result);
    }

    [Theory]
    [AutoData]
    public async Task IsAuthorizedAsync_InvalidToken_ReturnsFalse(byte[] tokenBytes, string guestSessionId)
    {
        string tokenString = Convert.ToBase64String(tokenBytes);
        var hashString = Convert.ToBase64String(SHA256.HashData(tokenBytes));

        _mockGuestSessionRepository
            .Setup(r => r.GetByTokenHash(hashString))
            .ReturnsAsync((GuestSession?)null);

        bool result = await _guestSessionService.IsAuthorizedAsync(tokenString, guestSessionId);

        Assert.False(result);
    }

    [Theory]
    [AutoData]
    public async Task IsAuthorizedAsync_InvalidGuestSessionId_ReturnsFalse(GuestSession guestSession, byte[] tokenBytes, string guestSessionId)
    {
        string tokenString = Convert.ToBase64String(tokenBytes);
        var hashString = Convert.ToBase64String(SHA256.HashData(tokenBytes));
        guestSession.SessionTokenHash = hashString;

        _mockGuestSessionRepository
            .Setup(r => r.GetByTokenHash(hashString))
            .ReturnsAsync(guestSession);

        bool result = await _guestSessionService.IsAuthorizedAsync(tokenString, guestSessionId);

        Assert.False(result);
    }
    [Theory]
    [AutoData]
    public async Task SubmitCartAsync_Valid_SubmitsSuccessfuilly(GuestSession guestSession, GroupReservation groupReservation, Dish[] dishes)
    {
        foreach (var dish in dishes)
            dish.State = DishState.Available;

        guestSession.IsSubmitted = false;
        guestSession.GroupReservationId = groupReservation.GroupReservationId;

        _mockGuestSessionRepository
            .Setup(r => r.GetByGuestSessionId(guestSession.Id))
            .ReturnsAsync(guestSession);

        _mockGroupReservationRepository
           .Setup(r => r.GetGroupReservationByIdAsync(guestSession.GroupReservationId))
           .ReturnsAsync(groupReservation);

        _mockDishRepository
            .Setup(d => d.GetDishesByIdsAsync(It.IsAny<IEnumerable<string>>()))
            .ReturnsAsync(dishes);

        GuestSession? session = null;
        _mockGuestSessionRepository
            .Setup(r => r.SaveAsync(It.IsAny<GuestSession>()))
            .Callback<GuestSession>(s => session = s);

        await _guestSessionService.SubmitCartAsync(guestSession.Id);

        Assert.NotNull(session);
        Assert.True(session.IsSubmitted);
    }

    [Theory]
    [AutoData]
    public async Task SubmitCartAsync_SessionNotFound_ThrowsGuestSessionNotFound(string guestSessionId)
    {
        _mockGuestSessionRepository
            .Setup(r => r.GetByGuestSessionId(guestSessionId))
            .ReturnsAsync((GuestSession?)null);

        await Assert.ThrowsAsync<GuestSessionNotFoundException>(() => _guestSessionService.SubmitCartAsync(guestSessionId));
    }

    [Theory]
    [InlineAutoData(GroupReservationStatus.Submitted, typeof(GroupReservationSubmittedException))]
    [InlineAutoData(GroupReservationStatus.Closed, typeof(GroupReservationExpiredException))]
    public async Task SubmitCartAsync_GroupReservationNotOpen_ThrowsException(GroupReservationStatus status, Type exceptionType, GuestSession guestSession, GroupReservation groupReservation)
    {
        guestSession.GroupReservationId = groupReservation.GroupReservationId;
        groupReservation.Status = status;

        _mockGuestSessionRepository
            .Setup(r => r.GetByGuestSessionId(guestSession.Id))
            .ReturnsAsync(guestSession);

        _mockGroupReservationRepository
            .Setup(r => r.GetGroupReservationByIdAsync(guestSession.GroupReservationId))
            .ReturnsAsync(groupReservation);

        await Assert.ThrowsAsync(exceptionType, () => _guestSessionService.SubmitCartAsync(guestSession.Id));
    }

    [Theory]
    [AutoData]
    public async Task SubmitCartAsync_GuestSessionHasNoDishes_ThrowsCartIsEmptyException(GuestSession guestSession, GroupReservation groupReservation)
    {
        guestSession.Dishes = [];
        guestSession.GroupReservationId = groupReservation.GroupReservationId;
        groupReservation.Status = GroupReservationStatus.Open;

        _mockGuestSessionRepository
            .Setup(r => r.GetByGuestSessionId(guestSession.Id))
            .ReturnsAsync(guestSession);

        _mockGroupReservationRepository
            .Setup(r => r.GetGroupReservationByIdAsync(guestSession.GroupReservationId))
            .ReturnsAsync(groupReservation);

        await Assert.ThrowsAsync<CartIsEmptyException>(() => _guestSessionService.SubmitCartAsync(guestSession.Id));
    }

    [Theory]
    [AutoData]
    public async Task SubmitCartAsync_GuestSessionSubmitted_ThrowsAlreadySubmited(GuestSession guestSession, GroupReservation groupReservation)
    {
        guestSession.IsSubmitted = true;
        guestSession.GroupReservationId = groupReservation.GroupReservationId;
        groupReservation.Status = GroupReservationStatus.Open;

        _mockGuestSessionRepository
            .Setup(r => r.GetByGuestSessionId(guestSession.Id))
            .ReturnsAsync(guestSession);

        _mockGroupReservationRepository
            .Setup(r => r.GetGroupReservationByIdAsync(guestSession.GroupReservationId))
            .ReturnsAsync(groupReservation);

        await Assert.ThrowsAsync<GuestSessionSubmittedException>(() => _guestSessionService.SubmitCartAsync(guestSession.Id));
    }

    [Theory]
    [InlineAutoData(DishState.OutOfStock)]
    [InlineAutoData(DishState.OnStop)]
    public async Task SubmitCartAsync_DishNotAvailable_ThrowsDishNotAvailable(DishState state, Dish dish, GuestSession guestSession, GroupReservation groupReservation)
    {
        dish.State = state;
        guestSession.IsSubmitted = false;
        guestSession.GroupReservationId = groupReservation.GroupReservationId;
        guestSession.Dishes = 
        [
            new OrderItem()
            {
                DishId = dish.Id,
                Quantity = 1,
            }
        ];

        _mockDishRepository
            .Setup(d => d.GetDishesByIdsAsync(It.IsAny<IEnumerable<string>>()))
            .ReturnsAsync([dish]);

        _mockGuestSessionRepository
            .Setup(r => r.GetByGuestSessionId(guestSession.Id))
            .ReturnsAsync(guestSession);

        _mockGroupReservationRepository
           .Setup(r => r.GetGroupReservationByIdAsync(guestSession.GroupReservationId))
           .ReturnsAsync(groupReservation);

        await Assert.ThrowsAsync<DishIsNotAvailableException>(() => _guestSessionService.SubmitCartAsync(guestSession.Id));
    }
    [Theory]
    [MemberAutoData(nameof(PepareDishesForGuestSession))]
    public async Task GetGuestSessionInfoAsync_Guest_ReturnsAsync(
        IEnumerable<string> dishIds,
        IEnumerable<Dish> dishes,
        List<OrderItem> orderItems,
        decimal expectedTotal,
        GuestSession session)
    {
        session.Dishes = orderItems;
        session.IsOwnerSession = false;

        _mockDishRepository
            .Setup(r => r.GetDishesByIdsAsync(dishIds))
            .ReturnsAsync(dishes);

        _mockGuestSessionRepository
            .Setup(r => r.GetByGuestSessionId(session.Id))
            .ReturnsAsync(session);

        GetGuestSessionResponse result = await _guestSessionService.GetGuestSessionInfoAsync(session.Id);

        Assert.Equal(session.GuestName, result.Name);
        Assert.Equal(dishes.Count(), result.Items.Count());
        Assert.Equal(expectedTotal, result.Total);
    }

    [Theory]
    [MemberAutoData(nameof(PepareDishesForGuestSession))]
    public async Task GetGuestSessionInfoAsync_GroupOwner_ReturnsAsync(
        IEnumerable<string> dishIds,
        IEnumerable<Dish> dishes,
        List<OrderItem> orderItems,
        decimal expectedTotal,
        GuestSession session,
        GroupReservation groupReservation,
        Reservation reservation,
        string customerId,
        string ownerName,
        UserType userType)
    {
        session.Dishes = orderItems;
        session.IsOwnerSession = true;
        session.GroupReservationId = groupReservation.GroupReservationId;
        groupReservation.ReservationId = reservation.Id;
        reservation.CustomerId = customerId;
        userType.Attributes.Add(new AttributeType()
        {
            Name = "given_name",
            Value = ownerName,
        });

        _mockDishRepository
            .Setup(r => r.GetDishesByIdsAsync(dishIds))
            .ReturnsAsync(dishes);

        _mockGuestSessionRepository
            .Setup(r => r.GetByGuestSessionId(session.Id))
            .ReturnsAsync(session);

        _mockGroupReservationRepository
            .Setup(r => r.GetGroupReservationByIdAsync(groupReservation.GroupReservationId))
            .ReturnsAsync(groupReservation);

        _mockReservationRepository
            .Setup(r => r.GetReservationByIdAsync(reservation.Id))
            .ReturnsAsync(reservation);

        _mockUserRepository
            .Setup(r => r.GetUserByIdAsync(customerId))
            .ReturnsAsync(userType);

        GetGuestSessionResponse result = await _guestSessionService.GetGuestSessionInfoAsync(session.Id);

        Assert.Equal(ownerName, result.Name);
        Assert.Equal(dishes.Count(), result.Items.Count());
        Assert.Equal(expectedTotal, result.Total);
    }

    [Fact]
    public async Task GetAllSessionsForOwnerAsync_IncludesOwnerAndGuestAndCalculatesTotals()
    {
        const string groupReservationId = "group-1";
        const string userId = "owner-1";
        const string ownerDishId = "dish-1";
        const string guestDishId = "dish-2";
        var groupReservation = new GroupReservation
        {
            GroupReservationId = groupReservationId,
            ReservationId = "reservation-1",
            ReservationToken = "token"
        };
        var reservation = new Reservation
        {
            Id = groupReservation.ReservationId,
            CustomerId = userId,
            TableId = "table-1",
            WaiterId = "waiter-1"
        };
        var ownerSession = new GuestSession
        {
            Id = "owner-session",
            GroupReservationId = groupReservationId,
            GuestName = "Owner",
            Dishes = [new OrderItem { DishId = ownerDishId, Quantity = 2 }],
            IsOwnerSession = true,
            OwnerUserId = userId
        };
        var guestSession = new GuestSession
        {
            Id = "guest-session",
            GroupReservationId = groupReservationId,
            GuestName = "Guest",
            Dishes = [new OrderItem { DishId = guestDishId, Quantity = 1 }],
            IsSubmitted = true
        };
        var ownerDish = new Dish { Id = ownerDishId, Name = "Soup", Price = 100 };
        var guestDish = new Dish { Id = guestDishId, Name = "Salad", Price = 50 };
        var owner = new UserType
        {
            Attributes = [new AttributeType { Name = "given_name", Value = "Alex" }]
        };

        _mockGroupReservationRepository
            .Setup(repository => repository.GetGroupReservationByIdAsync(groupReservationId))
            .ReturnsAsync(groupReservation);
        _mockReservationRepository
            .Setup(repository => repository.GetReservationByIdAsync(groupReservation.ReservationId))
            .ReturnsAsync(reservation);
        _mockGuestSessionRepository
            .Setup(repository => repository.GetAllByGroupReservationIdAsync(groupReservationId))
            .ReturnsAsync([ownerSession, guestSession]);
        _mockDishRepository
            .Setup(repository => repository.GetDishesByIdsAsync(It.IsAny<IEnumerable<string>>()))
            .ReturnsAsync([ownerDish, guestDish]);
        _mockUserRepository
            .Setup(repository => repository.GetUserByIdAsync(userId))
            .ReturnsAsync(owner);

        GetAllSessionsResponse result = await _guestSessionService.GetAllSessionsForOwnerAsync(userId, groupReservationId);

        Assert.Equal(2, result.Participants.Count());
        var ownerParticipant = Assert.Single(result.Participants, participant => participant.Type == ParticipantType.Owner);
        Assert.Equal(ownerSession.Id, ownerParticipant.Id);
        Assert.Equal("Alex", ownerParticipant.Name);
        Assert.Equal(200m, ownerParticipant.Total);
        var ownerItem = Assert.Single(ownerParticipant.Items);
        Assert.Equal(ownerDishId, ownerItem.Dish.Id);
        Assert.Equal(2, ownerItem.Quantity);
        var guestParticipant = Assert.Single(result.Participants, participant => participant.Type == ParticipantType.Guest);
        Assert.Equal(guestSession.Id, guestParticipant.Id);
        Assert.Equal("Guest", guestParticipant.Name);
        Assert.True(guestParticipant.IsSubmitted);
        Assert.Equal(50m, guestParticipant.Total);
        Assert.Equal(250m, result.Total);
    }

    [Fact]
    public async Task GetAllSessionsForOwnerAsync_NonOwnerThrowsActionForbiddenException()
    {
        var groupReservation = new GroupReservation
        {
            GroupReservationId = "group-1",
            ReservationId = "reservation-1",
            ReservationToken = "token"
        };
        var reservation = new Reservation
        {
            Id = groupReservation.ReservationId,
            CustomerId = "actual-owner",
            TableId = "table-1",
            WaiterId = "waiter-1"
        };

        _mockGroupReservationRepository
            .Setup(repository => repository.GetGroupReservationByIdAsync(groupReservation.GroupReservationId))
            .ReturnsAsync(groupReservation);
        _mockReservationRepository
            .Setup(repository => repository.GetReservationByIdAsync(groupReservation.ReservationId))
            .ReturnsAsync(reservation);

        await Assert.ThrowsAsync<ActionForbiddenException>(
            () => _guestSessionService.GetAllSessionsForOwnerAsync("another-user", groupReservation.GroupReservationId));
        _mockGuestSessionRepository.Verify(
            repository => repository.GetAllByGroupReservationIdAsync(It.IsAny<string>()),
            Times.Never);
    }

    [Fact]
    public async Task GetAllSessionsForOwnerAsync_MissingGroupReservationThrowsNotFound()
    {
        _mockGroupReservationRepository
            .Setup(repository => repository.GetGroupReservationByIdAsync("missing-group"))
            .ReturnsAsync((GroupReservation?)null);

        await Assert.ThrowsAsync<GroupReservationNotFoundException>(
            () => _guestSessionService.GetAllSessionsForOwnerAsync("owner", "missing-group"));
    }

    [Fact]
    public async Task GetAllSessionsForOwnerAsync_EmptyGroupReturnsEmptySnapshot()
    {
        var groupReservation = new GroupReservation
        {
            GroupReservationId = "group-1",
            ReservationId = "reservation-1",
            ReservationToken = "token"
        };
        var reservation = new Reservation
        {
            Id = groupReservation.ReservationId,
            CustomerId = "owner",
            TableId = "table-1",
            WaiterId = "waiter-1"
        };
        _mockGroupReservationRepository
            .Setup(repository => repository.GetGroupReservationByIdAsync(groupReservation.GroupReservationId))
            .ReturnsAsync(groupReservation);
        _mockReservationRepository
            .Setup(repository => repository.GetReservationByIdAsync(groupReservation.ReservationId))
            .ReturnsAsync(reservation);
        _mockGuestSessionRepository
            .Setup(repository => repository.GetAllByGroupReservationIdAsync(groupReservation.GroupReservationId))
            .ReturnsAsync([]);

        GetAllSessionsResponse result = await _guestSessionService.GetAllSessionsForOwnerAsync("owner", groupReservation.GroupReservationId);

        Assert.Empty(result.Participants);
        Assert.Equal(0, result.Total);
        _mockDishRepository.Verify(
            repository => repository.GetDishesByIdsAsync(It.IsAny<IEnumerable<string>>()),
            Times.Never);
    }

    [Fact]
    public async Task DeleteGuestSessionAsync_DeletesGuestAndReturnsUpdatedSnapshot()
    {
        const string groupReservationId = "group-1";
        const string guestSessionId = "guest-to-delete";
        const string remainingGuestSessionId = "remaining-guest";
        const string dishId = "dish-1";
        var groupReservation = new GroupReservation
        {
            GroupReservationId = groupReservationId,
            ReservationId = "reservation-1",
            ReservationToken = "token"
        };
        var reservation = new Reservation
        {
            Id = groupReservation.ReservationId,
            CustomerId = "owner-1",
            TableId = "table-1",
            WaiterId = "waiter-1"
        };
        var guestToDelete = new GuestSession
        {
            Id = guestSessionId,
            GroupReservationId = groupReservationId,
            GuestName = "Removed Guest",
            Dishes = []
        };
        var remainingGuest = new GuestSession
        {
            Id = remainingGuestSessionId,
            GroupReservationId = groupReservationId,
            GuestName = "Remaining Guest",
            Dishes = [new OrderItem { DishId = dishId, Quantity = 3 }],
            IsSubmitted = true
        };
        var dish = new Dish { Id = dishId, Name = "Soup", Price = 50 };

        _mockGroupReservationRepository
            .Setup(repository => repository.GetGroupReservationByIdAsync(groupReservationId))
            .ReturnsAsync(groupReservation);
        _mockReservationRepository
            .Setup(repository => repository.GetReservationByIdAsync(groupReservation.ReservationId))
            .ReturnsAsync(reservation);
        _mockGuestSessionRepository
            .Setup(repository => repository.GetByGuestSessionId(guestSessionId))
            .ReturnsAsync(guestToDelete);
        _mockGuestSessionRepository
            .Setup(repository => repository.GetAllByGroupReservationIdAsync(groupReservationId))
            .ReturnsAsync([guestToDelete, remainingGuest]);
        _mockDishRepository
            .Setup(repository => repository.GetDishesByIdsAsync(It.IsAny<IEnumerable<string>>()))
            .ReturnsAsync([dish]);

        GetAllSessionsResponse result = await _guestSessionService.DeleteGuestSessionAsync(
            "owner-1",
            groupReservationId,
            guestSessionId);

        _mockGuestSessionRepository.Verify(
            repository => repository.DeleteAsync(guestToDelete),
            Times.Once);
        var participant = Assert.Single(result.Participants);
        Assert.Equal(remainingGuestSessionId, participant.Id);
        Assert.Equal(ParticipantType.Guest, participant.Type);
        Assert.Equal("Remaining Guest", participant.Name);
        Assert.True(participant.IsSubmitted);
        Assert.Equal(150m, participant.Total);
        var item = Assert.Single(participant.Items);
        Assert.Equal(dishId, item.Dish.Id);
        Assert.Equal("Soup", item.Dish.Name);
        Assert.Equal(50m, item.Dish.Price);
        Assert.Equal(3, item.Quantity);
        Assert.Equal(150m, result.Total);
    }

    [Fact]
    public async Task DeleteGuestSessionAsync_MissingGuestSessionThrowsNotFound()
    {
        var groupReservation = new GroupReservation
        {
            GroupReservationId = "group-1",
            ReservationId = "reservation-1",
            ReservationToken = "token"
        };
        var reservation = new Reservation
        {
            Id = groupReservation.ReservationId,
            CustomerId = "owner-1",
            TableId = "table-1",
            WaiterId = "waiter-1"
        };
        _mockGroupReservationRepository
            .Setup(repository => repository.GetGroupReservationByIdAsync(groupReservation.GroupReservationId))
            .ReturnsAsync(groupReservation);
        _mockReservationRepository
            .Setup(repository => repository.GetReservationByIdAsync(groupReservation.ReservationId))
            .ReturnsAsync(reservation);
        _mockGuestSessionRepository
            .Setup(repository => repository.GetByGuestSessionId("missing-session"))
            .ReturnsAsync((GuestSession?)null);

        await Assert.ThrowsAsync<GuestSessionNotFoundException>(() =>
            _guestSessionService.DeleteGuestSessionAsync(
                "owner-1",
                groupReservation.GroupReservationId,
                "missing-session"));
        _mockGuestSessionRepository.Verify(
            repository => repository.DeleteAsync(It.IsAny<GuestSession>()),
            Times.Never);
    }

    [Fact]
    public async Task DeleteGuestSessionAsync_SessionFromAnotherGroupThrowsValidationException()
    {
        var groupReservation = new GroupReservation
        {
            GroupReservationId = "group-1",
            ReservationId = "reservation-1",
            ReservationToken = "token"
        };
        var reservation = new Reservation
        {
            Id = groupReservation.ReservationId,
            CustomerId = "owner-1",
            TableId = "table-1",
            WaiterId = "waiter-1"
        };
        var otherGroupSession = new GuestSession
        {
            Id = "guest-session",
            GroupReservationId = "group-2",
            GuestName = "Guest",
            Dishes = []
        };
        _mockGroupReservationRepository
            .Setup(repository => repository.GetGroupReservationByIdAsync(groupReservation.GroupReservationId))
            .ReturnsAsync(groupReservation);
        _mockReservationRepository
            .Setup(repository => repository.GetReservationByIdAsync(groupReservation.ReservationId))
            .ReturnsAsync(reservation);
        _mockGuestSessionRepository
            .Setup(repository => repository.GetByGuestSessionId(otherGroupSession.Id))
            .ReturnsAsync(otherGroupSession);

        await Assert.ThrowsAsync<ValidationException>(() =>
            _guestSessionService.DeleteGuestSessionAsync(
                "owner-1",
                groupReservation.GroupReservationId,
                otherGroupSession.Id));
        _mockGuestSessionRepository.Verify(
            repository => repository.DeleteAsync(It.IsAny<GuestSession>()),
            Times.Never);
    }

    [Fact]
    public async Task DeleteGuestSessionAsync_NonOwnerThrowsForbidden()
    {
        var groupReservation = new GroupReservation
        {
            GroupReservationId = "group-1",
            ReservationId = "reservation-1",
            ReservationToken = "token"
        };
        var reservation = new Reservation
        {
            Id = groupReservation.ReservationId,
            CustomerId = "actual-owner",
            TableId = "table-1",
            WaiterId = "waiter-1"
        };
        _mockGroupReservationRepository
            .Setup(repository => repository.GetGroupReservationByIdAsync(groupReservation.GroupReservationId))
            .ReturnsAsync(groupReservation);
        _mockReservationRepository
            .Setup(repository => repository.GetReservationByIdAsync(groupReservation.ReservationId))
            .ReturnsAsync(reservation);

        await Assert.ThrowsAsync<ActionForbiddenException>(() =>
            _guestSessionService.DeleteGuestSessionAsync(
                "another-user",
                groupReservation.GroupReservationId,
                "guest-session"));
        _mockGuestSessionRepository.Verify(
            repository => repository.DeleteAsync(It.IsAny<GuestSession>()),
            Times.Never);
    }

    [Fact]
    public async Task DeleteGuestSessionAsync_OwnerSessionCannotBeDeleted()
    {
        var groupReservation = new GroupReservation
        {
            GroupReservationId = "group-1",
            ReservationId = "reservation-1",
            ReservationToken = "token"
        };
        var reservation = new Reservation
        {
            Id = groupReservation.ReservationId,
            CustomerId = "owner-1",
            TableId = "table-1",
            WaiterId = "waiter-1"
        };
        var ownerSession = new GuestSession
        {
            Id = "owner-session",
            GroupReservationId = groupReservation.GroupReservationId,
            GuestName = "Owner",
            Dishes = [],
            IsOwnerSession = true,
            OwnerUserId = "owner-1"
        };
        _mockGroupReservationRepository
            .Setup(repository => repository.GetGroupReservationByIdAsync(groupReservation.GroupReservationId))
            .ReturnsAsync(groupReservation);
        _mockReservationRepository
            .Setup(repository => repository.GetReservationByIdAsync(groupReservation.ReservationId))
            .ReturnsAsync(reservation);
        _mockGuestSessionRepository
            .Setup(repository => repository.GetByGuestSessionId(ownerSession.Id))
            .ReturnsAsync(ownerSession);

        await Assert.ThrowsAsync<ValidationException>(() =>
            _guestSessionService.DeleteGuestSessionAsync(
                "owner-1",
                groupReservation.GroupReservationId,
                ownerSession.Id));
        _mockGuestSessionRepository.Verify(
            repository => repository.DeleteAsync(It.IsAny<GuestSession>()),
            Times.Never);
    }

    [Fact]
    public async Task GetOwnerGuestSessionIdAsync_ReturnsOwnerSessionForReservationOwner()
    {
        var reservation = new Reservation
        {
            Id = "reservation-1",
            CustomerId = "owner-1",
            TableId = "table-1",
            WaiterId = "waiter-1"
        };
        var group = new GroupReservation
        {
            GroupReservationId = "group-1",
            ReservationId = reservation.Id,
            ReservationToken = "token"
        };
        var ownerSession = new GuestSession
        {
            Id = "owner-group-1",
            GroupReservationId = group.GroupReservationId,
            GuestName = "Owner",
            Dishes = [],
            IsOwnerSession = true,
            OwnerUserId = "owner-1"
        };

        _mockReservationRepository
            .Setup(repository => repository.GetReservationByIdAsync(reservation.Id))
            .ReturnsAsync(reservation);
        _mockGroupReservationRepository
            .Setup(repository => repository.GetByReservationIdAsync(reservation.Id))
            .ReturnsAsync(group);
        _mockGuestSessionRepository
            .Setup(repository => repository.GetByGuestSessionId("owner-group-1"))
            .ReturnsAsync(ownerSession);

        GetOwnerGuestSessionIdResponse result =
            await _guestSessionService.GetOwnerGuestSessionIdAsync("owner-1", reservation.Id);

        Assert.Equal(ownerSession.Id, result.GuestSessionId);
        Assert.Equal(group.GroupReservationId, result.GroupReservationId);
    }

    [Fact]
    public async Task GetOwnerGuestSessionIdAsync_NonOwnerIsForbidden()
    {
        var reservation = new Reservation
        {
            Id = "reservation-1",
            CustomerId = "owner-1",
            TableId = "table-1",
            WaiterId = "waiter-1"
        };
        _mockReservationRepository
            .Setup(repository => repository.GetReservationByIdAsync(reservation.Id))
            .ReturnsAsync(reservation);

        await Assert.ThrowsAsync<ActionForbiddenException>(
            () => _guestSessionService.GetOwnerGuestSessionIdAsync("another-user", reservation.Id));
        _mockGroupReservationRepository.Verify(
            repository => repository.GetByReservationIdAsync(It.IsAny<string>()),
            Times.Never);
    }

    [Fact]
    public async Task SubmitGroupPreOrderAsync_MergesSubmittedGuestQuantitiesWithExistingOrderOnce()
    {
        const string groupId = "group-1";
        const string reservationId = "reservation-1";
        const string ownerId = "owner-1";
        var reservation = new Reservation
        {
            Id = reservationId,
            CustomerId = ownerId,
            TableId = "table-1",
            WaiterId = "waiter-1"
        };
        var group = new GroupReservation
        {
            GroupReservationId = groupId,
            ReservationId = reservationId,
            ReservationToken = "token",
            Status = GroupReservationStatus.Open
        };
        var submittedGuest1 = new GuestSession
        {
            Id = "guest-1",
            GroupReservationId = groupId,
            GuestName = "Guest 1",
            Dishes =
            [
                new OrderItem { DishId = "dish-1", Quantity = 2 },
                new OrderItem { DishId = "dish-2", Quantity = 1 }
            ],
            IsSubmitted = true
        };
        var submittedGuest2 = new GuestSession
        {
            Id = "guest-2",
            GroupReservationId = groupId,
            GuestName = "Guest 2",
            Dishes =
            [
                new OrderItem { DishId = "dish-1", Quantity = 1 },
                new OrderItem { DishId = "dish-2", Quantity = 1 }
            ],
            IsSubmitted = true
        };
        var unsubmittedGuest = new GuestSession
        {
            Id = "guest-3",
            GroupReservationId = groupId,
            GuestName = "Guest 3",
            Dishes = [new OrderItem { DishId = "dish-1", Quantity = 20 }],
            IsSubmitted = false
        };
        var ownerSession = new GuestSession
        {
            Id = "owner-group-1",
            GroupReservationId = groupId,
            GuestName = "Owner",
            Dishes = [new OrderItem { DishId = "dish-2", Quantity = 100 }],
            IsSubmitted = true,
            IsOwnerSession = true,
            OwnerUserId = ownerId
        };
        var order = new Order
        {
            OrderId = "order-1",
            CustomerId = ownerId,
            ReservationId = reservationId,
            ReservationAddress = "Address",
            ReservationTime = "Time",
            Dishes =
            [
                new OrderItem { DishId = "dish-1", Quantity = 4, State = OrderItemState.Confirmed },
                new OrderItem { DishId = "dish-3", Quantity = 5, State = OrderItemState.Pending }
            ],
            Status = OrderStatus.Created
        };
        Order? savedOrder = null;
        GroupReservation? savedGroup = null;

        _mockReservationRepository
            .Setup(repository => repository.GetReservationByIdAsync(reservationId))
            .ReturnsAsync(reservation);
        _mockGroupReservationRepository
            .Setup(repository => repository.GetGroupReservationByIdAsync(groupId))
            .ReturnsAsync(group);
        _mockGuestSessionRepository
            .Setup(repository => repository.GetAllByGroupReservationIdAsync(groupId))
            .ReturnsAsync([submittedGuest1, submittedGuest2, unsubmittedGuest, ownerSession]);
        _mockOrderRepository
            .Setup(repository => repository.GetOrderByReservationIdAsync(reservationId))
            .ReturnsAsync(order);
        _mockGroupReservationRepository
            .Setup(repository => repository.SubmitOrderAtomicallyAsync(
                It.IsAny<Order>(),
                It.IsAny<GroupReservation>()))
            .Callback<Order, GroupReservation>((submittedOrder, submittedGroup) =>
            {
                savedOrder = submittedOrder;
                savedGroup = submittedGroup;
            })
            .Returns(Task.CompletedTask);

        List<ConsolidatedOrderItemResponse> result = await _guestSessionService.SubmitGroupPreOrderAsync(
            ownerId,
            groupId,
            reservationId);

        Assert.Collection(
            result,
            item =>
            {
                Assert.Equal("dish-1", item.DishId);
                Assert.Equal(3, item.Quantity);
            },
            item =>
            {
                Assert.Equal("dish-2", item.DishId);
                Assert.Equal(2, item.Quantity);
            });
        Assert.NotNull(savedOrder);
        Assert.Equal(OrderStatus.SubmittedByCustomer, savedOrder.Status);
        Assert.Equal(7, savedOrder.Dishes.Single(item => item.DishId == "dish-1").Quantity);
        Assert.Equal(OrderItemState.Pending, savedOrder.Dishes.Single(item => item.DishId == "dish-1").State);
        Assert.Equal(2, savedOrder.Dishes.Single(item => item.DishId == "dish-2").Quantity);
        Assert.Equal(5, savedOrder.Dishes.Single(item => item.DishId == "dish-3").Quantity);
        Assert.NotNull(savedGroup);
        Assert.Equal(GroupReservationStatus.Submitted, savedGroup.Status);
    }

    [Fact]
    public async Task SubmitGroupPreOrderAsync_NoSubmittedGuestSessionReturnsBadRequest()
    {
        var reservation = new Reservation
        {
            Id = "reservation-1",
            CustomerId = "owner-1",
            TableId = "table-1",
            WaiterId = "waiter-1"
        };
        var group = new GroupReservation
        {
            GroupReservationId = "group-1",
            ReservationId = reservation.Id,
            ReservationToken = "token",
            Status = GroupReservationStatus.Open
        };
        _mockReservationRepository
            .Setup(repository => repository.GetReservationByIdAsync(reservation.Id))
            .ReturnsAsync(reservation);
        _mockGroupReservationRepository
            .Setup(repository => repository.GetGroupReservationByIdAsync(group.GroupReservationId))
            .ReturnsAsync(group);
        _mockGuestSessionRepository
            .Setup(repository => repository.GetAllByGroupReservationIdAsync(group.GroupReservationId))
            .ReturnsAsync([]);

        await Assert.ThrowsAsync<ValidationException>(() =>
            _guestSessionService.SubmitGroupPreOrderAsync("owner-1", group.GroupReservationId, reservation.Id));
        _mockOrderRepository.Verify(
            repository => repository.GetOrderByReservationIdAsync(It.IsAny<string>()),
            Times.Never);
    }

    [Fact]
    public async Task SubmitGroupPreOrderAsync_NoDishesInSubmittedGuestSessionsReturnsBadRequest()
    {
        var reservation = new Reservation
        {
            Id = "reservation-1",
            CustomerId = "owner-1",
            TableId = "table-1",
            WaiterId = "waiter-1"
        };
        var group = new GroupReservation
        {
            GroupReservationId = "group-1",
            ReservationId = reservation.Id,
            ReservationToken = "token",
            Status = GroupReservationStatus.Open
        };
        var session = new GuestSession
        {
            Id = "guest-session",
            GroupReservationId = group.GroupReservationId,
            GuestName = "Guest",
            Dishes = [],
            IsSubmitted = true
        };
        _mockReservationRepository
            .Setup(repository => repository.GetReservationByIdAsync(reservation.Id))
            .ReturnsAsync(reservation);
        _mockGroupReservationRepository
            .Setup(repository => repository.GetGroupReservationByIdAsync(group.GroupReservationId))
            .ReturnsAsync(group);
        _mockGuestSessionRepository
            .Setup(repository => repository.GetAllByGroupReservationIdAsync(group.GroupReservationId))
            .ReturnsAsync([session]);

        await Assert.ThrowsAsync<ValidationException>(() =>
            _guestSessionService.SubmitGroupPreOrderAsync("owner-1", group.GroupReservationId, reservation.Id));
        _mockOrderRepository.Verify(
            repository => repository.GetOrderByReservationIdAsync(It.IsAny<string>()),
            Times.Never);
    }

    [Fact]
    public async Task SubmitGroupPreOrderAsync_MissingOrderReturnsBadRequest()
    {
        var reservation = new Reservation
        {
            Id = "reservation-1",
            CustomerId = "owner-1",
            TableId = "table-1",
            WaiterId = "waiter-1"
        };
        var group = new GroupReservation
        {
            GroupReservationId = "group-1",
            ReservationId = reservation.Id,
            ReservationToken = "token",
            Status = GroupReservationStatus.Open
        };
        var session = new GuestSession
        {
            Id = "guest-session",
            GroupReservationId = group.GroupReservationId,
            GuestName = "Guest",
            Dishes = [new OrderItem { DishId = "dish-1", Quantity = 1 }],
            IsSubmitted = true
        };
        _mockReservationRepository
            .Setup(repository => repository.GetReservationByIdAsync(reservation.Id))
            .ReturnsAsync(reservation);
        _mockGroupReservationRepository
            .Setup(repository => repository.GetGroupReservationByIdAsync(group.GroupReservationId))
            .ReturnsAsync(group);
        _mockGuestSessionRepository
            .Setup(repository => repository.GetAllByGroupReservationIdAsync(group.GroupReservationId))
            .ReturnsAsync([session]);
        _mockOrderRepository
            .Setup(repository => repository.GetOrderByReservationIdAsync(reservation.Id))
            .ReturnsAsync((Order?)null);

        await Assert.ThrowsAsync<ValidationException>(() =>
            _guestSessionService.SubmitGroupPreOrderAsync("owner-1", group.GroupReservationId, reservation.Id));
    }

    public static TheoryData<IEnumerable<string>, IEnumerable<Dish>, List<OrderItem>, decimal> PepareDishesForGuestSession()
    {
        var dishMap = new Dictionary<string, Dish>()
        {
            ["1"] = new()
            {
                Id = "1",
                Price = 1
            },
            ["2"] = new()
            {
                Id = "2",
                Price = 2
            },
            ["3"] = new()
            {
                Id = "3",
                Price = 3
            }
        };

        var orderItems = new List<OrderItem>
        {
            new OrderItem()
                    {
                        DishId = "1",
                        Quantity = 2
                    },
                    new OrderItem()
                    {
                        DishId = "2",
                        Quantity = 3
                    },
                    new OrderItem()
                    {
                        DishId = "3",
                        Quantity = 1
                    }
        };

        var expectedTotal = orderItems.Sum(o => dishMap[o.DishId].Price * o.Quantity);

        return new()
        {
            { dishMap.Keys, dishMap.Values, orderItems, expectedTotal }
        };
    }
}
