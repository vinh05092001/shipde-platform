import {
  LayoutDashboard,
  Package,
  AlertTriangle,
  DollarSign,
  RotateCcw,
  TrendingUp,
  FileText,
  Settings,
  Store,
  GitBranch,
  Users,
  Key,
  Lock,
  User,
  Shield,
} from 'lucide-react';

export interface NavTarget {
  id: string;
  label: string;
  href: string;
  group: string;
  icon: typeof Package;
  permissions: readonly string[];
}

// Existing console tab destinations and canonical implemented settings routes.
// Permission codes belong to the existing live RBAC catalog, never a client role fallback.
const targets: NavTarget[] = [
  {
    id: 'dashboard',
    label: 'Bàn Điều Khiển & 3 Sổ',
    href: '/?view=dashboard',
    group: 'Tổng quan',
    icon: LayoutDashboard,
    permissions: [
      'order:view_create',
      'reconciliation:run_review_audit',
      'shipment:track_exceptions',
    ],
  },
  {
    id: 'shipments',
    label: 'Quản Lý Vận Đơn',
    href: '/?view=shipments',
    group: 'Đơn hàng',
    icon: Package,
    permissions: ['order:view_create', 'shipment:track_exceptions'],
  },
  {
    id: 'exceptions',
    label: 'Hộp Việc Cứu Đơn',
    href: '/?view=exceptions',
    group: 'Vận hành giao hàng',
    icon: AlertTriangle,
    permissions: ['shipment:track_exceptions'],
  },
  {
    id: 'returns',
    label: 'Quản Lý Nhập Hoàn',
    href: '/?view=returns',
    group: 'Vận hành giao hàng',
    icon: RotateCcw,
    permissions: ['shipment:receive_return'],
  },
  {
    id: 'reconciliation',
    label: 'Đối Soát COD & Cước',
    href: '/?view=reconciliation',
    group: 'Đối soát',
    icon: DollarSign,
    permissions: ['reconciliation:run_review_audit'],
  },
  {
    id: 'three_ledgers',
    label: 'Báo Cáo Ba Sổ',
    href: '/?view=three_ledgers',
    group: 'Báo cáo',
    icon: TrendingUp,
    permissions: ['reconciliation:allocate_bank_receipt'],
  },
  {
    id: 'claims',
    label: 'Hồ Sơ Bồi Thường',
    href: '/?view=claims',
    group: 'Khiếu nại',
    icon: FileText,
    permissions: ['claim:verify_submit'],
  },
  {
    id: 'settings',
    label: 'Cài Đặt Cửa Hàng',
    href: '/?view=settings',
    group: 'Cấu hình',
    icon: Settings,
    permissions: ['iam:shop_config'],
  },
  {
    id: 'shop',
    label: 'Hồ sơ shop',
    href: '/settings/shop',
    group: 'Cấu hình',
    icon: Store,
    permissions: ['iam:shop_view', 'iam:shop_config'],
  },
  {
    id: 'branches',
    label: 'Chi nhánh',
    href: '/settings/branches',
    group: 'Cấu hình',
    icon: GitBranch,
    permissions: ['iam:shop_view', 'iam:shop_config'],
  },
  {
    id: 'warehouses',
    label: 'Kho hàng',
    href: '/settings/warehouses',
    group: 'Cấu hình',
    icon: Package,
    permissions: ['iam:shop_view', 'iam:shop_config'],
  },
  {
    id: 'users',
    label: 'Người dùng',
    href: '/settings/users',
    group: 'Cấu hình',
    icon: Users,
    permissions: ['iam:manage_users'],
  },
  {
    id: 'roles',
    label: 'Vai trò và quyền',
    href: '/settings/roles',
    group: 'Cấu hình',
    icon: Shield,
    permissions: ['iam:manage_users'],
  },
  {
    id: 'carriers',
    label: 'Tài khoản hãng',
    href: '/?view=settings&section=integrations',
    group: 'Cấu hình',
    icon: Key,
    permissions: ['iam:connect_observe_token'],
  },
];

export function getNavigation(permissions: readonly string[]): NavTarget[] {
  return targets.filter((t) => t.permissions.some((p) => permissions.includes(p)));
}

export interface RoleConfiguration {
  id: string;
  code: string | null;
  is_system: boolean;
  permissions: { code: string }[];
}
export interface ShellProfile {
  role: string;
  custom_role_id?: string | null;
}
export function resolveRolePermissions(
  profile: ShellProfile,
  roles: RoleConfiguration[]
): string[] {
  const role = profile.custom_role_id
    ? roles.find((r) => !r.is_system && r.id === profile.custom_role_id)
    : roles.find((r) => r.is_system && r.code === profile.role);
  return role?.permissions.map((p) => p.code) ?? [];
}

export const personalTargets = [
  { href: '/settings/profile', label: 'Hồ sơ cá nhân', icon: User },
  { href: '/settings/security', label: 'Bảo mật tài khoản', icon: Shield },
  { href: '/sessions', label: 'Phiên đăng nhập', icon: Lock },
];

export function currentHref(pathname: string, query: string): string {
  if (pathname !== '/') return pathname;
  const params = new URLSearchParams(query);
  const view = params.get('view') || 'dashboard';
  return '/?view=' + view + (params.get('section') ? '&section=' + params.get('section') : '');
}

export interface Crumb {
  label: string;
  href?: string;
}
export function deriveBreadcrumbs(
  pathname: string,
  query: string,
  permitted: NavTarget[]
): Crumb[] {
  const href = currentHref(pathname, query);
  const target =
    permitted.find((t) => t.href === href) ??
    permitted
      .filter((t) => !t.href.includes('?') && pathname.startsWith(t.href + '/'))
      .sort((a, b) => b.href.length - a.href.length)[0];
  const personal = personalTargets.find((t) => t.href === pathname);
  if (!target)
    return [{ label: 'Ship Dễ', href: '/' }, { label: personal?.label ?? 'Trang hiện tại' }];
  return [
    { label: 'Ship Dễ', href: '/' },
    { label: target.group },
    { label: target.label, ...(target.href !== href ? { href: target.href } : {}) },
    ...(target.href !== href ? [{ label: 'Chi tiết' }] : []),
  ];
}
