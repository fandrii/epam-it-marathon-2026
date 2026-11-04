using System.Text.Json.Serialization;

namespace APIHandler.Models.GuestSessions;

public record ConsolidatedOrderItemResponse(
    [property: JsonPropertyName("dishId")] string DishId,
    [property: JsonPropertyName("quantity")] int Quantity);
