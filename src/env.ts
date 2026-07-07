import { z } from 'zod'

const envSchema = z.object({
  UIGRAPH_MCP_SERVER_URL: z.url().min(1),
  UIGRAPH_ACCESS_TOKEN: z.string().optional(),
  UIGRAPH_ORG_ID: z.string().optional(),
})

function parseEnv(): z.infer<typeof envSchema> {
  const result = envSchema.safeParse(process.env)
  if (result.success) return result.data
  console.error('Invalid environment variables:')
  for (const issue of result.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`)
  }
  process.exit(1)
}

export const env = parseEnv()
