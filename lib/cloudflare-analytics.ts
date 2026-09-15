// lib/cloudflare-analytics.ts
//
// Optional: Class A/B R2 operation counts for /admin/usage's Advanced
// mode. Unlike lib/r2-usage.ts's storage/object-count stats (available
// from the S3-compatible credentials this app already has), R2
// request/operation counts are only exposed through Cloudflare's
// account-level GraphQL Analytics API — which needs its own API token
// (CLOUDFLARE_API_TOKEN, "Account Analytics: Read" scope; see
// .env.example), separate from the R2_ACCESS_KEY_ID/SECRET pair and NOT
// configured by default. Every caller here degrades to `null` (never
// throws) if the token is unset or the request fails, so this is always
// safe to call speculatively from the dashboard.
//
// Not independently verified against a live account — this query is
// written from Cloudflare's documented R2 GraphQL Analytics schema
// (r2OperationsAdaptiveGroups under viewer.accounts), but there was no
// CLOUDFLARE_API_TOKEN available in this environment to actually run it
// against. If this returns null even with a token configured, check the
// query shape against Cloudflare's current GraphQL schema (available
// via the GraphQL Analytics API explorer in the Cloudflare dashboard)
// before assuming the token itself is the problem.

const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

export type R2OperationsSummary = {
  classAOps: number;
  classBOps: number;
  rangeStart: string;
  rangeEnd: string;
};

type GraphQLResponse = {
  data?: {
    viewer?: {
      accounts?: {
        r2OperationsAdaptiveGroups?: {
          sum?: { requests?: number };
          dimensions?: { actionType?: string };
        }[];
      }[];
    };
  };
  errors?: { message: string }[];
};

// Cloudflare's R2 action types that bill as Class A (writes/lists) vs
// Class B (reads) — see https://developers.cloudflare.com/r2/pricing/.
const CLASS_A_ACTIONS = new Set([
  "PutObject",
  "PutBucket",
  "ListObjects",
  "ListBuckets",
  "CopyObject",
  "CompleteMultipartUpload",
  "CreateMultipartUpload",
  "UploadPart",
  "UploadPartCopy",
  "LifecycleStorageTierTransition",
]);

export async function getR2OperationsSummary(
  bucketName: string,
  days: number
): Promise<R2OperationsSummary | null> {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.R2_ACCOUNT_ID;
  if (!token || !accountId) return null;

  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

  const query = `
    query R2Operations($accountTag: String!, $bucket: String!, $since: Time!, $until: Time!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          r2OperationsAdaptiveGroups(
            limit: 100
            filter: { bucketName: $bucket, datetime_geq: $since, datetime_leq: $until }
          ) {
            sum {
              requests
            }
            dimensions {
              actionType
            }
          }
        }
      }
    }
  `;

  try {
    const res = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables: {
          accountTag: accountId,
          bucket: bucketName,
          since: start.toISOString(),
          until: end.toISOString(),
        },
      }),
      // Never let a slow/hanging analytics call block the dashboard.
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;
    const json = (await res.json()) as GraphQLResponse;
    if (json.errors && json.errors.length > 0) {
      console.error("[cloudflare-analytics] GraphQL errors:", json.errors.map((e) => e.message).join("; "));
      return null;
    }

    const groups = json.data?.viewer?.accounts?.[0]?.r2OperationsAdaptiveGroups;
    if (!Array.isArray(groups)) return null;

    let classAOps = 0;
    let classBOps = 0;
    for (const g of groups) {
      const requests = g.sum?.requests ?? 0;
      const actionType = g.dimensions?.actionType ?? "";
      if (CLASS_A_ACTIONS.has(actionType)) classAOps += requests;
      else classBOps += requests;
    }

    return { classAOps, classBOps, rangeStart: start.toISOString(), rangeEnd: end.toISOString() };
  } catch (err) {
    console.error("[cloudflare-analytics] R2 operations query failed:", err);
    return null;
  }
}
