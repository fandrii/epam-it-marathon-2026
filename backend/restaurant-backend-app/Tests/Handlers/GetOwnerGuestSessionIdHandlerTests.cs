using Amazon.Lambda.APIGatewayEvents;
using Amazon.Lambda.Core;
using APIHandler.Exceptions;
using APIHandler.Handlers.Reservations;
using APIHandler.Models.GuestSessions;
using APIHandler.Services.GuestSessions;
using Moq;
using System.Collections.Generic;

namespace APIHandler.Tests.Handlers;

public class GetOwnerGuestSessionIdHandlerTests
{
    private readonly Mock<IGuestSessionService> _guestSessionService = new();
    private readonly Mock<ILambdaContext> _lambdaContext = new();

    public GetOwnerGuestSessionIdHandlerTests()
    {
        _lambdaContext.SetupGet(context => context.Logger).Returns(Mock.Of<ILambdaLogger>());
    }

    [Fact]
    public async Task HandleRequest_OwnerReceivesSessionAndGroupIds()
    {
        _guestSessionService
            .Setup(service => service.GetOwnerGuestSessionIdAsync("owner-1", "reservation-1"))
            .ReturnsAsync(new GetOwnerGuestSessionIdResponse("owner-session", "group-1"));

        var handler = new GetOwnerGuestSessionIdHandler(_guestSessionService.Object);
        APIGatewayProxyResponse response = await handler.HandleRequest(
            CreateRequest(authenticated: true),
            _lambdaContext.Object);

        Assert.Equal(200, response.StatusCode);
        Assert.Contains("\"guestSessionId\":\"owner-session\"", response.Body);
        Assert.Contains("\"groupReservationId\":\"group-1\"", response.Body);
    }

    [Fact]
    public async Task HandleRequest_NonOwnerReceivesForbidden()
    {
        _guestSessionService
            .Setup(service => service.GetOwnerGuestSessionIdAsync("owner-1", "reservation-1"))
            .ThrowsAsync(new ActionForbiddenException("Only the reservation owner may retrieve this information."));

        var handler = new GetOwnerGuestSessionIdHandler(_guestSessionService.Object);
        APIGatewayProxyResponse response = await handler.HandleRequest(
            CreateRequest(authenticated: true),
            _lambdaContext.Object);

        Assert.Equal(403, response.StatusCode);
    }

    [Fact]
    public async Task HandleRequest_MissingUserClaimReturnsUnauthorized()
    {
        var handler = new GetOwnerGuestSessionIdHandler(_guestSessionService.Object);
        APIGatewayProxyResponse response = await handler.HandleRequest(
            CreateRequest(authenticated: false),
            _lambdaContext.Object);

        Assert.Equal(401, response.StatusCode);
        _guestSessionService.Verify(
            service => service.GetOwnerGuestSessionIdAsync(
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
                ["reservationId"] = "reservation-1"
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
