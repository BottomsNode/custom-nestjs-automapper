import { NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Mapper } from '../core/mapper';

export class AutoMapInterceptor<T extends object> implements NestInterceptor<T, any> {
    constructor(
        private mapper: Mapper,
        private destination: new () => any
    ) {}

    intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<any> {
        return next.handle().pipe(
            map(data => {
                if (Array.isArray(data)) {
                    return this.mapper.mapArray(data, this.destination);
                }
                return this.mapper.map(data, this.destination);
            })
        );
    }
}
