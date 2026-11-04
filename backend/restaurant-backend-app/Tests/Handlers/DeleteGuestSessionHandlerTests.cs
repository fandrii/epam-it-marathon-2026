using Amazon.Lambda.APIGatewayEvents;
using Amazon.Lambda.Core;
using APIHandler.Exceptions;
using APIHandler.Handlers.GuestSessions;
using APIHandler.Services.GuestSessions;
using Moq;
using System.Collections.Generic;

namespace APIHandler.Tests.Handlers;

public class DeleteGuestSessionHandlerTests
{
    private readonly Mock<IGuestSessionService> _guestSessionService = new();
    private readonly Mock<ILambdaContext> _lambdaContext = new();

    public DeleteGuestSessionHandlerTests()
    {
        _lambdaContext.SetupGet(context => context.Logger).Returns(Mock.Of<ILambdaLogger>());
    }

    [Fact]
    public async Task HandleRequest_MissingGuestSessionReturns404()
    {
        _guestSessionService
            .Setup(service => service.DeleteGuestSessionAsync("owner-1", "group-1", "session-1"))
            .ThrowsAsync(new GuestSessionNotFoundException("Guest session not found."));

        var handler = new DeleteGuestSessionHandler(_guestSessionService.Object);
        APIGatewayProxyResponse response = await handler.HandleRequest(
            CreateRequest(authenticated: true),
            _lambdaContext.Object);

        Assert.Equal(404, response.StatusCode);
    }

    [Fact]
    public async Task HandleRequest_SessionFromAnotherGroupReturns400()
    {
        _guestSessionService
            .Setup(service => service.DeleteGuestSessionAsync("owner-1", "group-1", "session-1"))
            .ThrowsAsync(new ValidationException("Guest session does not belong to this group reservation."));

        var handler = new DeleteGuestSessionHandler(_guestSessionService.Object);
        APIGatewayProxyResponse response = await handler.HandleRequest(
            CreateRequest(authenticated: true),
            _lambdaContext.Object);

        Assert.Equal(400, response.StatusCode);
    }

    [Fact]
    public async Task HandleRequest_NonOwnerReturns403()
    {
        _guestSessionService
            .Setup(service => service.DeleteGuestSessionAsync("owner-1", "group-1", "session-1"))
            .ThrowsAsync(new ActionForbiddenException("Only the reservation owner can perform this action."));

        var handler = new DeleteGuestSessionHandler(_guestSessionService.Object);
        APIGatewayProxyResponse response = await handler.HandleRequest(
            CreateRequest(authenticated: true),
            _lambdaContext.Object);

        Assert.Equal(403, response.StatusCode);
    }

    [Fact]
    public async Task HandleRequest_MissingUserClaimReturns401()
    {
        var handler = new DeleteGuestSessionHandler(_guestSessionService.Object);
        APIGatewayProxyResponse response = await handler.HandleRequest(
            CreateRequest(authenticated: false),
            _lambdaContext.Object);

        Assert.Equal(401, response.StatusCode);
        _guestSessionService.Verify(
            service => service.DeleteGuestSessionAsync(
                It.IsAny<string>(),
                It.IsAny<string>(),
                It.IsAny<string>()),
            Times.Never);
    }

    private static APIGatewayProxyRequest CreateRequest(bool authenticated)
    {
        var request = new APIGatewayProxyRequest
        {
            PathParameters = new Dictionary<string, string>
            {
                ["groupReservationId"] = "group-1",
                ["guestSessionId"] = "session-1"
            }
        };

        if (authenticated)
        {
            request.RequestContext = new APIGatewayProxyRequest.ProxyRequestContext
            {
                Authorizer = new APIGatewayCustomAuthorizerContext
                {
                    Claims = new Dictionary<string, string> { ["sub"] = "owner-1" }
                }
            };
        }

        return request;
    }
}
