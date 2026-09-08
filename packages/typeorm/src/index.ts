/**
 * TypeORM schema adapter — Phase 4.
 *
 * Verified available on typeorm@1.1.1 and required by CAP-5 / CAP-8:
 *   DataSource.getMetadata
 *   ColumnMetadata   isPrimary · isGenerated · isCreateDate · isUpdateDate
 *                    isDeleteDate · isVersion · isDiscriminator · isSelect
 *                    · isNullable · databaseName · propertyName
 *   RelationMetadata joinColumns · inverseJoinColumns · relationType
 *                    · inverseEntityMetadata · isNullable
 *
 * AD-14: describe() returns everything the schema declares and applies NO
 * policy. Filtering belongs to the planner alone.
 */
export const ADAPTER_NAME = 'typeorm';
