import { DynamicModule, Global, Module, Type } from '@nestjs/common';
import { Mapper } from '../core/mapper';
import { MappingProfile } from '../core/mapping-profile';
import type { MappingEntryOptions } from '../core/types';
import type { CacheConfig } from '../core/types';

export interface AutomapperModuleOptions {
    globalOptions?: MappingEntryOptions;
    profiles?: Type<MappingProfile>[];
    autoDiscover?: boolean;
    cache?: CacheConfig;
}

@Global()
@Module({})
export class AutomapperModule {
    static forRoot(options?: AutomapperModuleOptions): DynamicModule {
        const mapperProvider = {
            provide: Mapper,
            useFactory: () => {
                // Mapper constructor should accept an options bag that may include cache config.
                const mapper = new Mapper({
                    ...(options?.globalOptions || {}),
                    cache: options?.cache
                } as any);

                if (options?.profiles) {
                    options.profiles.forEach(ProfileClass => {
                        new ProfileClass(mapper);
                    });
                }

                return mapper;
            }
        };

        const profileProviders =
            options?.profiles?.map(ProfileClass => ({
                provide: ProfileClass,
                useFactory: (mapper: Mapper) => new ProfileClass(mapper),
                inject: [Mapper]
            })) || [];

        return {
            module: AutomapperModule,
            providers: [mapperProvider, ...profileProviders],
            exports: [Mapper, ...profileProviders]
        };
    }

    static forFeature(profiles: Type<MappingProfile>[]): DynamicModule {
        const profileProviders = profiles.map(ProfileClass => ({
            provide: ProfileClass,
            useFactory: (mapper: Mapper) => new ProfileClass(mapper),
            inject: [Mapper]
        }));

        return {
            module: AutomapperModule,
            providers: profileProviders,
            exports: profileProviders
        };
    }
}
