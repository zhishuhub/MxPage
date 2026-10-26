import { NextRequest } from "next/server";
import { managedProviderGuard } from "@/lib/zhishu/guard";

import { resolveProviderConnectionInput, testProviderConnection } from "@/lib/services/provider-service";
import { providerInputSchema } from "@/lib/validations/provider";
import { handleRouteError, ok } from "@/lib/utils/route";
import { withProviderCredentials } from "@/lib/services/provider-runtime";

export async function POST(request: NextRequest) {
  const blocked = managedProviderGuard();
  if (blocked) return blocked;
  return withProviderCredentials(request, async () => {
    try {
    const parsed = providerInputSchema.parse(await request.json());
    const input = await resolveProviderConnectionInput(parsed);
    const result = await testProviderConnection(input);
    return ok(result);
    } catch (error) {
      return handleRouteError(error);
    }
  });
}
