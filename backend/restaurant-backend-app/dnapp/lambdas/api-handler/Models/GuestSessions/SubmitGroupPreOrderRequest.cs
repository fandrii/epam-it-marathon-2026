using System.Text.Json.Serialization;

namespace APIHandler.Models.GuestSessions;

public class SubmitGroupPreOrderRequest
{
    [JsonPropertyName("reservationId")]
    public required string ReservationId { get; set; }
}
