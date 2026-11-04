using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.DataModel;
using Amazon.DynamoDBv2.Model;
using APIHandler.Constants;
using APIHandler.Entities;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace APIHandler.Repositories.GroupReservations;

public class GroupReservationRepository : IGroupReservationRepository
{
    private static readonly string GroupReservationsTableName = ResourceNames.GroupReservationsTableName;
    private readonly IDynamoDBContext _dynamoDbContext;
    private readonly IAmazonDynamoDB _dynamoDbClient;

    public GroupReservationRepository(IDynamoDBContext dynamoDbContext, IAmazonDynamoDB dynamoDbClient)
    {
        _dynamoDbContext = dynamoDbContext ?? throw new ArgumentNullException(nameof(dynamoDbContext));
        _dynamoDbClient = dynamoDbClient ?? throw new ArgumentNullException(nameof(dynamoDbClient));
    }

    public async Task<GroupReservation?> GetGroupReservationByIdAsync(string groupReservationId)
    {
        return await _dynamoDbContext.LoadAsync<GroupReservation>(groupReservationId, DynamoConfig.LoadConfig(GroupReservationsTableName));
    }

    public async Task DeleteGroupReservationAsync(GroupReservation groupReservation)
    {
        await _dynamoDbContext.DeleteAsync(groupReservation, DynamoConfig.DeleteConfig(GroupReservationsTableName));
    }

    public async Task SaveGroupReservationAsync(GroupReservation groupReservation)
    {
        await _dynamoDbContext.SaveAsync(groupReservation, DynamoConfig.SaveConfig(GroupReservationsTableName));
    }

    public async Task SubmitOrderAtomicallyAsync(Order order, GroupReservation groupReservation)
    {
        var orderConfig = new DynamoDBOperationConfig
        {
            OverrideTableName = ResourceNames.OrdersTableName
        };
        var groupConfig = new DynamoDBOperationConfig
        {
            OverrideTableName = GroupReservationsTableName
        };

        var orderDocument = _dynamoDbContext.ToDocument(order, orderConfig);
        var createdOrder = _dynamoDbContext.ToDocument(new Order
        {
            OrderId = order.OrderId,
            CustomerId = order.CustomerId,
            ReservationId = order.ReservationId,
            ReservationAddress = order.ReservationAddress,
            ReservationTime = order.ReservationTime,
            Dishes = [],
            Status = OrderStatus.Created
        }, orderConfig);
        var groupDocument = _dynamoDbContext.ToDocument(groupReservation, groupConfig);
        var openGroup = _dynamoDbContext.ToDocument(new GroupReservation
        {
            GroupReservationId = groupReservation.GroupReservationId,
            ReservationId = groupReservation.ReservationId,
            ReservationToken = groupReservation.ReservationToken,
            Status = GroupReservationStatus.Open
        }, groupConfig);

        var transaction = new TransactWriteItemsRequest
        {
            TransactItems =
            [
                new TransactWriteItem
                {
                    Update = new Update
                    {
                        TableName = ResourceNames.OrdersTableName,
                        Key = new Dictionary<string, AttributeValue>
                        {
                            ["orderId"] = orderDocument.ToAttributeMap()["orderId"],
                            ["customerId"] = orderDocument.ToAttributeMap()["customerId"]
                        },
                        UpdateExpression = "SET #dishes = :dishes, #status = :submitted",
                        ConditionExpression = "attribute_exists(#orderId) AND #reservationId = :reservationId AND #status = :created",
                        ExpressionAttributeNames = new Dictionary<string, string>
                        {
                            ["#orderId"] = "orderId",
                            ["#reservationId"] = "reservationId",
                            ["#dishes"] = "dishes",
                            ["#status"] = "status"
                        },
                        ExpressionAttributeValues = new Dictionary<string, AttributeValue>
                        {
                            [":dishes"] = orderDocument.ToAttributeMap()["dishes"],
                            [":submitted"] = orderDocument.ToAttributeMap()["status"],
                            [":created"] = createdOrder.ToAttributeMap()["status"],
                            [":reservationId"] = new() { S = order.ReservationId }
                        }
                    }
                },
                new TransactWriteItem
                {
                    Update = new Update
                    {
                        TableName = GroupReservationsTableName,
                        Key = new Dictionary<string, AttributeValue>
                        {
                            ["groupReservationId"] = groupDocument.ToAttributeMap()["groupReservationId"]
                        },
                        UpdateExpression = "SET #status = :submitted",
                        ConditionExpression = "attribute_exists(#groupReservationId) AND #reservationId = :reservationId AND #status = :open",
                        ExpressionAttributeNames = new Dictionary<string, string>
                        {
                            ["#groupReservationId"] = "groupReservationId",
                            ["#reservationId"] = "reservationId",
                            ["#status"] = "status"
                        },
                        ExpressionAttributeValues = new Dictionary<string, AttributeValue>
                        {
                            [":submitted"] = groupDocument.ToAttributeMap()["status"],
                            [":open"] = openGroup.ToAttributeMap()["status"],
                            [":reservationId"] = new() { S = groupReservation.ReservationId }
                        }
                    }
                }
            ]
        };

        await _dynamoDbClient.TransactWriteItemsAsync(transaction);
    }

    public async Task<GroupReservation?> GetGroupReservationByTokenAsync(string token)
    {
        var results = await _dynamoDbContext.QueryAsync<GroupReservation?>(token, new QueryConfig
        {
            OverrideTableName = GroupReservationsTableName,
            IndexName = GlobalSecondaryIndexes.GroupReservation.ReservationToken,
        }).GetRemainingAsync();

        return results.FirstOrDefault();
    }

    public async Task<GroupReservation?> GetByReservationIdAsync(string reservationId)
    {
        var results = await _dynamoDbContext.QueryAsync<GroupReservation?>(reservationId, new QueryConfig
        {
            OverrideTableName = GroupReservationsTableName,
            IndexName = GlobalSecondaryIndexes.GroupReservation.ReservationId,
        }).GetRemainingAsync();

        return results.FirstOrDefault();
    }
}
