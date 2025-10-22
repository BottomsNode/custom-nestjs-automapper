import { DynamicModule, Global, Module, Type } from '@nestjs/common';
import { Mapper } from '../core/mapper';
import { MappingProfile } from '../core/mapping-profile';
import { MappingEntryOptions } from '../core/types';

export interface AutomapperModuleOptions {
    globalOptions?: MappingEntryOptions;
    profiles?: Type<MappingProfile>[];
    autoDiscover?: boolean;
}

@Global()
@Module({})
export class AutomapperModule {
    static forRoot(options?: AutomapperModuleOptions): DynamicModule {
        const mapperProvider = {
            provide: Mapper,
            useFactory: () => {
                const mapper = new Mapper(options?.globalOptions);

                if (options?.profiles) {
                    options.profiles.forEach(ProfileClass => {
                        new ProfileClass(mapper);
                    });
                }

                return mapper;
            }
        };

        const profileProviders = options?.profiles?.map(ProfileClass => ({
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