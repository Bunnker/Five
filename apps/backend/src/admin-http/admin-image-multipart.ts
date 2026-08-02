import multipart from "@fastify/multipart";

interface AdminImageMultipartFastifyInstance {
  register(plugin: unknown, options: unknown): PromiseLike<unknown>;
}

export const ADMIN_IMAGE_MAXIMUM_BYTES = 8 * 1024 * 1024;
export const ADMIN_IMAGE_METADATA_MAXIMUM_BYTES = 64 * 1024;

export async function installAdminImageMultipart(instance: unknown): Promise<void> {
  if (
    typeof instance !== "object" ||
    instance === null ||
    !("register" in instance) ||
    typeof instance.register !== "function"
  ) {
    throw new Error("Fastify multipart registration requires a Fastify instance");
  }
  const registrar = instance as AdminImageMultipartFastifyInstance;
  await registrar.register(multipart, {
    limits: {
      fieldSize: ADMIN_IMAGE_METADATA_MAXIMUM_BYTES,
      fields: 1,
      fileSize: ADMIN_IMAGE_MAXIMUM_BYTES,
      files: 1,
      parts: 2,
    },
  });
}
