using Amazon.Lambda.APIGatewayEvents;
using Amazon.Lambda.Core;
using APIHandler.Exceptions;
using APIHandler.Models;
using System;
using System.Collections.Generic;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace APIHandler.Helpers;

public static class ResponseBuilder
{
    private const string ProductionFrontendOrigin = "https://d2i0c1cgpzhx0k.cloudfront.net";

    private static readonly string[] AllowedOrigins =
    [
        ProductionFrontendOrigin,
        "http://localhost:4200",
        "https://localhost:4200",
        "http://localhost:3000",
        "https://localhost:3000"
    ];

    public static APIGatewayProxyResponse ApplyCorsHeaders(APIGatewayProxyResponse response, APIGatewayProxyRequest request)
    {
        var originHeader = request?.Headers is not null && request.Headers.TryGetValue("Origin", out var origin)
            ? origin
            : request?.Headers is not null && request.Headers.TryGetValue("origin", out origin)
                ? origin
                : null;

        var headers = response.Headers ?? new Dictionary<string, string>();
        var resolvedOrigin = ResolveOrigin(originHeader);

        if (!string.IsNullOrWhiteSpace(resolvedOrigin))
        {
            headers["Access-Control-Allow-Origin"] = resolvedOrigin;
            headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, PATCH, OPTIONS";
            headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Requested-With";
            headers["Vary"] = "Origin";
        }

        if (!headers.ContainsKey("Content-Type"))
        {
            headers["Content-Type"] = "application/json";
        }

        response.Headers = headers;
        return response;
    }

    private static Dictionary<string, string> BuildHeaders(string? requestOrigin = null)
    {
        var origin = ResolveOrigin(requestOrigin);
        var headers = new Dictionary<string, string>
        {
            { "Content-Type", "application/json" },
            { "Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS" },
            { "Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With" }
        };

        if (!string.IsNullOrWhiteSpace(origin))
        {
            headers["Access-Control-Allow-Origin"] = origin;
            headers["Vary"] = "Origin";
        }

        return headers;
    }

    private static string? ResolveOrigin(string? requestOrigin)
    {
        if (string.IsNullOrWhiteSpace(requestOrigin))
        {
            return ProductionFrontendOrigin;
        }

        var normalizedOrigin = requestOrigin.Trim();

        foreach (var allowedOrigin in AllowedOrigins)
        {
            if (string.Equals(normalizedOrigin, allowedOrigin, StringComparison.OrdinalIgnoreCase))
            {
                return allowedOrigin;
            }
        }

        return null;
    }

    public static APIGatewayProxyResponse CreateErrorResponse(
        int statusCode, string errorMessage, ILambdaLogger logger, Exception? ex = null, string? requestOrigin = null)
    {
        logger.LogLine($"[ERROR] {errorMessage}");

        if (ex != null)
        {
            logger.LogError($"[{ex.GetType().Name}] Exception: {ex}");
        }

        return new APIGatewayProxyResponse
        {
            StatusCode = statusCode,
            Body = JsonSerializer.Serialize(new { error = errorMessage }),
            Headers = BuildHeaders(requestOrigin),
        };
    }

    public static APIGatewayProxyResponse CreateErrorCodeResponse(ValidationException exception, string? requestOrigin = null)
        => CreateJsonResponse(400, new ErrorCodeResponse(exception.Message, exception switch
        {
            GroupReservationExpiredException => ErrorCode.GroupReservationExpired,
            GuestLimitExceededException => ErrorCode.GuestLimitExceeded,
            GroupReservationSubmittedException => ErrorCode.GroupReservationSubmitted,
            GuestSessionExpiredException => ErrorCode.GuestSessionExpired,
            _ => ErrorCode.Unknown
        }), requestOrigin);

    public static APIGatewayProxyResponse CreateSuccessResponse(string message, string? requestOrigin = null)
    {
        return new APIGatewayProxyResponse
        {
            StatusCode = 200,
            Body = JsonSerializer.Serialize(new { message = message }),
            Headers = BuildHeaders(requestOrigin),
        };
    }

    public static APIGatewayProxyResponse CreateOptionsResponse(string? requestOrigin = null)
    {
        return new APIGatewayProxyResponse
        {
            StatusCode = 200,
            Headers = BuildHeaders(requestOrigin),
        };
    }

    public static APIGatewayProxyResponse CreateSuccessResponse(object body, int statusCode = 200, string? requestOrigin = null)
    {
        return new APIGatewayProxyResponse
        {
            StatusCode = statusCode,
            Body = JsonSerializer.Serialize(body),
            Headers = BuildHeaders(requestOrigin),
        };
    }

    public static APIGatewayProxyResponse CreateJsonResponse(int statusCode, object body, string? requestOrigin = null)
    {
        var options = new JsonSerializerOptions
        {
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        };

        return new APIGatewayProxyResponse
        {
            StatusCode = statusCode,
            Body = JsonSerializer.Serialize(body, options),
            Headers = BuildHeaders(requestOrigin)
        };
    }

    public static APIGatewayProxyResponse CreatePlainTextResponse(int statusCode, string message, string? requestOrigin = null)
    {
        var headers = BuildHeaders(requestOrigin);
        headers["Content-Type"] = "text/plain";

        return new APIGatewayProxyResponse
        {
            StatusCode = statusCode,
            Body = message,
            Headers = headers
        };
    }

    public static APIGatewayProxyResponse CreateFileResponse(
        byte[] fileContent,
        string fileName,
        string contentType,
        string? requestOrigin = null)
    {
        bool isTextFormat = contentType.StartsWith("text/") || contentType == "application/json";

        var headers = BuildHeaders(requestOrigin);
        headers["Content-Type"] = contentType;
        headers["Content-Disposition"] = $"attachment; filename=\"{fileName}\"";

        return new APIGatewayProxyResponse
        {
            StatusCode = 200,
            IsBase64Encoded = !isTextFormat,
            Body = isTextFormat
                ? Encoding.UTF8.GetString(fileContent)
                : Convert.ToBase64String(fileContent),
            Headers = headers
        };
    }
}