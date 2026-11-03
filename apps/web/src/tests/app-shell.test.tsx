import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  deriveBreadcrumbs,
  getNavigation,
  resolveRolePermissions,
} from '../components/shell/navigation';
import { ShellNavigation, ShellBreadcrumbs, ShellSkeleton } from '../components/shell/AppShell';
import { CommandTargets } from '../components/shell/CommandPalette';

const roles = [
  {
    id: 'owner',
    code: 'OWNER',
    is_system: true,
    permissions: [{ code: 'iam:shop_config' }, { code: 'order:view_create' }],
  },
  {
    id: 'custom',
    code: null,
    is_system: false,
    permissions: [{ code: 'shipment:receive_return' }],
  },
];
assert.deepEqual(resolveRolePermissions({ role: 'OWNER', custom_role_id: 'custom' }, roles), [
  'shipment:receive_return',
]);
assert.deepEqual(resolveRolePermissions({ role: 'UNKNOWN' }, roles), []);
assert.deepEqual(resolveRolePermissions({ role: 'OWNER', custom_role_id: 'missing' }, roles), []);
const targets = getNavigation(['shipment:receive_return']);
assert(targets.some((t) => t.id === 'returns'));
assert(!targets.some((t) => t.id === 'settings' || t.id === 'claims'));
assert.deepEqual(getNavigation([]), []);
const nav = renderToStaticMarkup(<ShellNavigation targets={targets} activeHref="/?view=returns" />);
assert(nav.includes('aria-current="page"'));
assert(!nav.includes('Cài Đặt'));
assert(
  renderToStaticMarkup(<ShellNavigation targets={[]} activeHref="/" />).includes(
    'Chưa có mục điều hướng'
  )
);
const crumbs = deriveBreadcrumbs('/settings/branches', '', getNavigation(['iam:shop_config']));
assert.deepEqual(
  crumbs.map((c) => c.label),
  ['Ship Dễ', 'Cấu hình', 'Chi nhánh']
);
assert.equal(deriveBreadcrumbs('/', 'view=returns', targets).at(-1)?.label, 'Quản Lý Nhập Hoàn');
assert.equal(
  deriveBreadcrumbs('/settings/branches-old', '', targets).at(-1)?.label,
  'Trang hiện tại'
);
assert(renderToStaticMarkup(<ShellBreadcrumbs crumbs={crumbs} />).includes('aria-current="page"'));
const palette = renderToStaticMarkup(
  <CommandTargets targets={targets} query="hoàn" onSelect={() => {}} />
);
assert(palette.includes('Quản Lý Nhập Hoàn'));
assert(!palette.includes('Cài Đặt'));
assert(
  renderToStaticMarkup(
    <CommandTargets
      targets={getNavigation(['order:view_create'])}
      query="don"
      onSelect={() => {}}
    />
  ).includes('Quản Lý Vận Đơn'),
  'Vietnamese navigation search also matches unaccented đ'
);
assert.deepEqual(
  deriveBreadcrumbs('/settings/branches/branch-id', '', getNavigation(['iam:shop_config'])).slice(
    -2
  ),
  [{ label: 'Chi nhánh', href: '/settings/branches' }, { label: 'Chi tiết' }]
);
assert.equal(
  deriveBreadcrumbs(
    '/',
    'section=integrations&view=settings',
    getNavigation(['iam:connect_observe_token'])
  ).at(-1)?.label,
  'Tài khoản hãng'
);
assert(
  renderToStaticMarkup(
    <CommandTargets targets={targets} query="không khớp" onSelect={() => {}} />
  ).includes('Không tìm thấy')
);
assert(
  renderToStaticMarkup(<CommandTargets targets={[]} query="" onSelect={() => {}} />).includes(
    'Chưa có mục điều hướng'
  )
);
assert(renderToStaticMarkup(<ShellSkeleton />).includes('aria-busy="true"'));
console.log(
  'PASS: TASK-AI-159 permission filtering, navigation, breadcrumbs, palette and loading/empty components'
);
