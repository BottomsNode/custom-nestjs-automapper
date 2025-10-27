import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Mapper } from '../core/mapper copy';

/**
 * @MapBody
 * Maps the request body to the destination DTO using the provided Mapper.
 * @param destinationClass The class to map the body to
 * @param mapper Instance of Mapper (optional if you have global mapper)
 */
export const MapBody = (destinationClass: new () => any, mapper?: Mapper) =>
    createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
        const request = ctx.switchToHttp().getRequest();
        const body = request.body;
        if (!body) return body;
        return mapper ? mapper.map(body, destinationClass) : body;
    })();

/**
 * @MapQuery
 * Maps query parameters to the destination DTO using the provided Mapper.
 * @param destinationClass The class to map the query to
 * @param mapper Instance of Mapper (optional)
 */
export const MapQuery = (destinationClass: new () => any, mapper?: Mapper) =>
    createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
        const request = ctx.switchToHttp().getRequest();
        const query = request.query;
        if (!query) return query;
        return mapper ? mapper.map(query, destinationClass) : query;
    })();
