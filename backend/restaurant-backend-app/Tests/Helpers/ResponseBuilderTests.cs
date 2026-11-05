using Amazon.Lambda.Core;
using APIHandler.Helpers;
using Moq;
using System.Collections.Generic;

namespace APIHandler.Tests.Helpers;

public class ResponseBuilderTests
{
    [Fact]
    public void CreateOptionsResponse_UsesConfiguredFrontendOrigin()
    {
        var response = ResponseBuilder.CreateOptionsResponse("https://d2i0c1cgpzhx0k.cloudfront.net");

        Assert.Equal("https://d2i0c1cgpzhx0k.cloudfront.net", response.Headers!["Access-Control-Allow-Origin"]);
        Assert.Equal("GET, POST, PUT, DELETE, PATCH, OPTIONS", response.Headers["Access-Control-Allow-Methods"]);
        Assert.Equal("Content-Type, Authorization, X-Requested-With", response.Headers["Access-Control-Allow-Headers"]);
    }

    [Fact]
    public void CreateErrorResponse_DoesNotUseWildcardOriginForAuthenticatedRequests()
    {
        var logger = new Mock<ILambdaLogger>();

        var response = ResponseBuilder.CreateErrorResponse(401, "Unauthorized", logger.Object, requestOrigin: "https://d2i0c1cgpzhx0k.cloudfront.net");

        Assert.Equal("https://d2i0c1cgpzhx0k.cloudfront.net", response.Headers!["Access-Control-Allow-Origin"]);
        Assert.NotEqual("*", response.Headers["Access-Control-Allow-Origin"]);
    }

    [Fact]
    public void ApplyCorsHeaders_AddsConfiguredOriginToHandlerResponse()
    {
        var request = new Amazon.Lambda.APIGatewayEvents.APIGatewayProxyRequest
        {
            Headers = new Dictionary<string, string>
            {
                ["Origin"] = "https://d2i0c1cgpzhx0k.cloudfront.net"
            }
        };
        var response = new Amazon.Lambda.APIGatewayEvents.APIGatewayProxyResponse
        {
            StatusCode = 500,
            Headers = new Dictionary<string, string>()
        };

        ResponseBuilder.ApplyCorsHeaders(response, request);

        Assert.Equal("https://d2i0c1cgpzhx0k.cloudfront.net", response.Headers["Access-Control-Allow-Origin"]);
        Assert.Equal("GET, POST, PUT, DELETE, PATCH, OPTIONS", response.Headers["Access-Control-Allow-Methods"]);
        Assert.Equal("Content-Type, Authorization, X-Requested-With", response.Headers["Access-Control-Allow-Headers"]);
    }

    [Fact]
    public void ApplyCorsHeaders_DoesNotReflectUnapprovedOrigin()
    {
        var request = new Amazon.Lambda.APIGatewayEvents.APIGatewayProxyRequest
        {
            Headers = new Dictionary<string, string>
            {
                ["Origin"] = "https://untrusted.example"
            }
        };
        var response = new Amazon.Lambda.APIGatewayEvents.APIGatewayProxyResponse
        {
            StatusCode = 200,
            Headers = new Dictionary<string, string>()
        };

        ResponseBuilder.ApplyCorsHeaders(response, request);

        Assert.False(response.Headers.ContainsKey("Access-Control-Allow-Origin"));
    }
}
