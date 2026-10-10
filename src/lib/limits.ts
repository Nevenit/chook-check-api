/**
 * Workers Free allows 50 D1 queries per invocation. Each handler and scheduled
 * job stays within this budget, leaving headroom for middleware.
 */
export const D1_QUERY_BUDGET = 40;
