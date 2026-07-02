import { z } from 'zod'

const envSchema = z.object({
  UIGRAPH_MCP_SERVER_URL: z.url().min(1),
  UIGRAPH_ACCESS_TOKEN: z.string().optional(),
  UIGRAPH_ORG_ID: z.string().optional(),
})

function parseEnv(): z.infer<typeof envSchema> {
  try {
    return envSchema.parse(process.env)
  } catch {
    console.error('Invalid environment variables')
    process.exit(1)
  }
}

export const env = parseEnv()
