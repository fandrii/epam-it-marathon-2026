using APIHandler.Entities;
using APIHandler.Mappers;

namespace APIHandler.Tests.Mappers;

public class ReservationMapperTests
{
    [Fact]
    public void ToReservationResponse_ReportsWhetherReservationHasAGroup()
    {
        var reservation = new Reservation
        {
            Id = "reservation-1",
            TableId = "table-1",
            WaiterId = "waiter-1",
            CustomerId = "owner-1"
        };

        var groupResponse = ReservationMapper.ToReservationResponse(
            reservation,
            "Test address",
            hasGroupReservation: true);
        var individualResponse = ReservationMapper.ToReservationResponse(
            reservation,
            "Test address",
            hasGroupReservation: false);

        Assert.True(groupResponse.HasGroupReservation);
        Assert.False(individualResponse.HasGroupReservation);
    }
}
