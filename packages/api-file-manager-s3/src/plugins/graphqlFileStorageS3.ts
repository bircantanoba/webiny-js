import { GraphQLSchemaPlugin } from "@webiny/handler-graphql/types";
import { ErrorResponse, Response } from "@webiny/handler-graphql/responses";
import getPresignedPostPayload from "../utils/getPresignedPostPayload";

const BATCH_UPLOAD_MAX_FILES = 20;

const plugin: GraphQLSchemaPlugin = {
    type: "graphql-schema",
    name: "graphql-schema-api-file-manager-s3",
    schema: {
        typeDefs: /* GraphQL */ `
            input PreSignedPostPayloadInput {
                name: String!
                type: String!
                size: Int!
            }

            type GetPreSignedPostPayloadResponseDataFile {
                name: String
                type: String
                size: Int
                key: String
            }

            type GetPreSignedPostPayloadResponseData {
                # Contains data that is necessary for initiating a file upload.
                data: JSON
                file: UploadFileResponseDataFile
            }

            type GetPreSignedPostPayloadResponse {
                error: FileError
                data: GetPreSignedPostPayloadResponseData
            }

            type GetPreSignedPostPayloadsResponse {
                error: FileError
                data: [GetPreSignedPostPayloadResponseData]!
            }

            extend type FilesQuery {
                getPreSignedPostPayload(
                    data: PreSignedPostPayloadInput!
                ): GetPreSignedPostPayloadResponse
                getPreSignedPostPayloads(
                    data: [PreSignedPostPayloadInput]!
                ): GetPreSignedPostPayloadsResponse
            }
        `,
        resolvers: {
            FilesQuery: {
                getPreSignedPostPayload: async (root, args, context) => {
                    try {
                        const { data } = args;
                        const settings = context.fileManager.settings;
                        const response = await getPresignedPostPayload(data, settings);

                        return new Response(response);
                    } catch (e) {
                        return new ErrorResponse({
                            message: e.message,
                            code: e.code,
                            data: e.data
                        });
                    }
                },
                getPreSignedPostPayloads: async (root, args, context) => {
                    const { data: files } = args;
                    if (!Array.isArray(files)) {
                        return new ErrorResponse({
                            code: "UPLOAD_FILES_NON_ARRAY",
                            message: `"data" argument must be an array.`
                        });
                    }

                    if (files.length === 0) {
                        return new ErrorResponse({
                            code: "UPLOAD_FILES_MIN_FILES",
                            message: `"data" argument must contain at least one file.`
                        });
                    }

                    if (files.length > BATCH_UPLOAD_MAX_FILES) {
                        return new ErrorResponse({
                            code: "UPLOAD_FILES_MAX_FILES",
                            message: `"data" argument must not contain more than ${BATCH_UPLOAD_MAX_FILES} files.`
                        });
                    }

                    try {
                        const settings = context.fileManager.settings;

                        const promises = [];
                        for (let i = 0; i < files.length; i++) {
                            const item = files[i];
                            promises.push(getPresignedPostPayload(item, settings));
                        }

                        return new Response(await Promise.all(promises));
                    } catch (e) {
                        return new ErrorResponse({
                            message: e.message,
                            code: e.code,
                            data: e.data
                        });
                    }
                }
            }
        }
    }
};

export default plugin;