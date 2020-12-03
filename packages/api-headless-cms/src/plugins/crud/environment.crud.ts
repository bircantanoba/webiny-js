import defaults from "./defaults";
import mdbid from "mdbid";
import { ContextPlugin } from "@webiny/handler/types";
import { DbContext } from "@webiny/handler-db/types";
import { I18NContentContext } from "@webiny/api-i18n-content/types";
import { validation } from "@webiny/validation";
import { withFields, string } from "@commodo/fields";
import {
    CmsEnvironmentType,
    CmsEnvironmentContextType,
    CmsContextType
} from "@webiny/api-headless-cms/types";
import toSlug from "@webiny/api-headless-cms/utils/toSlug";
import { createEnvironmentAliasPk, createEnvironmentPk } from "./partitionKeys";
import { TenancyContext } from "@webiny/api-security-tenancy/types";

const CreateEnvironmentModel = withFields({
    name: string({ validation: validation.create("required,maxLength:100") }),
    slug: string({ validation: validation.create("maxLength:100") }),
    description: string({ validation: validation.create("maxLength:255") }),
    createdFrom: string({ validation: validation.create("required,maxLength:255") })
})();
const UpdateEnvironmentModel = withFields({
    name: string({ validation: validation.create("maxLength:100") }),
    slug: string({ validation: validation.create("maxLength:100") }),
    description: string({ validation: validation.create("maxLength:255") })
})();

const TYPE = "cms#env";

type BaseDynamoType = {
    PK: string;
    SK: string;
    TYPE: string;
};

export default {
    type: "context",
    apply(context) {
        const { db } = context;

        const environment: CmsEnvironmentContextType = {
            async get(id): Promise<CmsEnvironmentType | null> {
                const [response] = await db.read<CmsEnvironmentType>({
                    ...defaults.db,
                    query: { PK: createEnvironmentPk(context), SK: id },
                    limit: 1
                });
                if (!response || response.length === 0) {
                    return null;
                }
                return response.find(() => true);
            },
            async list(): Promise<CmsEnvironmentType[]> {
                const [response] = await db.read<CmsEnvironmentType>({
                    ...defaults.db,
                    query: { PK: createEnvironmentPk(context), SK: { $gt: " " } }
                });
                return response;
            },
            async create(data, createdBy, initial): Promise<CmsEnvironmentType> {
                const slug = toSlug(data.slug || data.name);
                const createData = new CreateEnvironmentModel().populate({
                    ...data,
                    slug
                });
                await createData.validate();

                const id = mdbid();

                const createDataJson = await createData.toJSON();

                // need to read all environments
                // because we need to check if environment with exact slug already exists
                // and to check if source environment environment actually exists - when required to
                const existingEnvironments = await context.cms.environment.list();
                const sourceEnvironment = existingEnvironments.find(model => {
                    return model.id === createDataJson.createdFrom;
                });

                // before create hook
                if (!initial && !sourceEnvironment) {
                    if (existingEnvironments.length === 0) {
                        throw new Error("There are no environments in the database.");
                    }
                    throw new Error(
                        `Base environment ("createdFrom" field) not set or environment "${createDataJson.createdFrom}" does not exist.`
                    );
                }

                const existing = existingEnvironments.some(model => {
                    return model.slug === slug;
                });
                if (existing) {
                    throw new Error(`Environment with slug "${slug}" already exists.`);
                }

                const model = Object.assign(createDataJson, {
                    PK: createEnvironmentPk(context),
                    SK: id,
                    TYPE,
                    id,
                    createdOn: new Date().toISOString(),
                    createdFrom: sourceEnvironment,
                    createdBy
                }) as CmsEnvironmentType & BaseDynamoType;

                // save
                await db.create({
                    ...defaults.db,
                    data: model
                });

                // after create hook
                // there is a possibility that there is no sourceEnvironment - installation process
                if (!sourceEnvironment) {
                    return model;
                }
                await context.cms.dataManager.copyEnvironment({
                    copyFrom: sourceEnvironment.id,
                    copyTo: id
                });
                //
                return model;
            },
            async update(id, data, model: CmsEnvironmentType): Promise<CmsEnvironmentType> {
                const slugValue = data.slug || data.name;
                const updateData = new UpdateEnvironmentModel().populate({
                    ...data,
                    slug: !!slugValue ? toSlug(slugValue) : undefined
                });
                await updateData.validate();

                const updatedDataJson = await updateData.toJSON({ onlyDirty: true });

                // no need to continue if no values were changed
                if (Object.keys(updatedDataJson).length === 0) {
                    return {} as any;
                }

                const updatedModel = Object.assign(updatedDataJson, {
                    changedOn: new Date().toISOString()
                });

                // run all updates in a batch
                const dbBatch = db.batch();
                const modelKeys = {
                    PK: createEnvironmentPk(context),
                    SK: id
                };
                dbBatch.update({
                    ...defaults.db,
                    query: modelKeys,
                    data: {
                        ...modelKeys,
                        ...model,
                        ...updatedModel
                    }
                });
                // after change hook
                const aliases = (await context.cms.environmentAlias.list()).filter(alias => {
                    return alias.environment.id === id;
                });
                // update all aliases last updated time
                const aliasPk = createEnvironmentAliasPk(context);
                for (const alias of aliases) {
                    const aliasKeys = {
                        PK: aliasPk,
                        SK: alias.id
                    };
                    dbBatch.update({
                        ...defaults.db,
                        query: aliasKeys,
                        data: {
                            ...aliasKeys,
                            ...alias,
                            changedOn: new Date().toISOString()
                        }
                    });
                }
                await dbBatch.execute();
                return updatedModel;
            },
            async delete(id): Promise<void> {
                // before delete hook
                const aliases = (await context.cms.environmentAlias.list())
                    .filter(alias => {
                        return alias.environment.id === id;
                    })
                    .map(alias => alias.name);
                if (aliases.length) {
                    throw new Error(
                        `Cannot delete the environment because it's currently linked to the "${aliases.join(
                            ", "
                        )}" environment aliases.`
                    );
                }
                // delete
                await db.delete({
                    ...defaults.db,
                    query: { PK: createEnvironmentPk(context), SK: id }
                });
                // after delete hook
                await context.cms.dataManager.deleteEnvironment({ environment: id });
            }
        };
        context.cms = {
            ...(context.cms || ({} as any)),
            environment
        };
    }
} as ContextPlugin<DbContext, I18NContentContext, CmsContextType, TenancyContext>;
