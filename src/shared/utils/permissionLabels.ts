import { PERMISSION_MODULES, type PermissionGrant } from "../constants/permissions.js";

const labelByCode = new Map<string, string>();
const moduleByCode = new Map<string, string>();

for (const mod of PERMISSION_MODULES) {
  for (const perm of mod.permissions) {
    labelByCode.set(perm.code, perm.label);
    moduleByCode.set(perm.code, mod.label);
  }
}

export function formatPermissionGrantLabel(
  grant: PermissionGrant,
  warehouseNameById?: Map<string, string>
): string {
  const label = labelByCode.get(grant.code) ?? grant.code;
  if (grant.warehouseId) {
    const wh =
      warehouseNameById?.get(grant.warehouseId) ?? grant.warehouseId.slice(-6);
    return `${label} · ${wh}`;
  }
  return label;
}

export function formatPermissionGrantsList(
  grants: PermissionGrant[],
  warehouseNameById?: Map<string, string>
): string[] {
  return grants.map((g) => formatPermissionGrantLabel(g, warehouseNameById));
}

export function diffPermissionGrants(
  before: PermissionGrant[],
  after: PermissionGrant[]
): { added: PermissionGrant[]; removed: PermissionGrant[] } {
  const key = (g: PermissionGrant) =>
    g.warehouseId ? `${g.code}:${g.warehouseId}` : g.code;
  const beforeSet = new Map(before.map((g) => [key(g), g]));
  const afterSet = new Map(after.map((g) => [key(g), g]));

  const added: PermissionGrant[] = [];
  const removed: PermissionGrant[] = [];

  for (const [k, g] of afterSet) {
    if (!beforeSet.has(k)) added.push(g);
  }
  for (const [k, g] of beforeSet) {
    if (!afterSet.has(k)) removed.push(g);
  }

  return { added, removed };
}
