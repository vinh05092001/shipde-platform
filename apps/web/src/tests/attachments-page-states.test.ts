import * as assert from 'node:assert';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FormattedAttachment, AttachmentBulkActionResult } from '@shipde/contracts';
import { AttachmentManagementView, formatFileSize } from '@/components/AttachmentManagementView';
import AttachmentsSettingsPage from '@/app/settings/attachments/page';
import { AuthProvider } from '@/context/AuthContext';

async function runAttachmentsWebTestSuite() {
  console.log('================================================================');
  console.log('SHIP DE - WEB ATTACHMENTS UI STATES TEST SUITE (FEAT-COM-06)');
  console.log('================================================================');

  const mockAttachmentActive: FormattedAttachment = {
    id: '11111111-1111-1111-1111-111111111111',
    merchant_id: 'm-tenant-1',
    file_name: 'damaged_box.png',
    file_size: 1048576, // 1MB
    mime_type: 'image/png',
    checksum_sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    storage_key:
      'merchants/m-tenant-1/attachments/11111111-1111-1111-1111-111111111111/damaged_box.png',
    entity_type: 'RETURN',
    entity_id: 'ret-12345',
    branch_id: 'branch-hcm',
    warehouse_id: 'wh-hcm-01',
    uploaded_by: 'u-user-1',
    status: 'ACTIVE',
    retention_days: 90,
    expires_at: new Date('2026-12-31T00:00:00Z').toISOString(),
    metadata: { scan_status: 'CLEAN' },
    created_at: new Date('2026-01-01T00:00:00Z').toISOString(),
    updated_at: new Date('2026-01-01T00:00:00Z').toISOString(),
  };

  const mockAttachmentQuarantined: FormattedAttachment = {
    id: '22222222-2222-2222-2222-222222222222',
    merchant_id: 'm-tenant-1',
    file_name: 'suspicious_invoice.pdf',
    file_size: 512000,
    mime_type: 'application/pdf',
    checksum_sha256: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    storage_key:
      'merchants/m-tenant-1/attachments/22222222-2222-2222-2222-222222222222/suspicious_invoice.pdf',
    entity_type: 'CLAIM',
    entity_id: 'claim-999',
    branch_id: null,
    warehouse_id: null,
    uploaded_by: 'u-user-2',
    status: 'QUARANTINED',
    retention_days: 30,
    expires_at: new Date('2026-02-01T00:00:00Z').toISOString(),
    metadata: { quarantine_reason: 'Script content detected' },
    created_at: new Date('2026-01-02T00:00:00Z').toISOString(),
    updated_at: new Date('2026-01-02T00:00:00Z').toISOString(),
  };

  const mockAttachmentPendingDeletion: FormattedAttachment = {
    id: '33333333-3333-3333-3333-333333333333',
    merchant_id: 'm-tenant-1',
    file_name: 'old_label.png',
    file_size: 2048,
    mime_type: 'image/png',
    checksum_sha256: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    storage_key:
      'merchants/m-tenant-1/attachments/33333333-3333-3333-3333-333333333333/old_label.png',
    entity_type: 'SHIPMENT',
    entity_id: 'ship-001',
    branch_id: null,
    warehouse_id: 'wh-hcm-01',
    uploaded_by: 'u-user-1',
    status: 'PENDING_DELETION',
    retention_days: 90,
    expires_at: new Date('2026-01-10T00:00:00Z').toISOString(),
    metadata: null,
    created_at: new Date('2026-01-03T00:00:00Z').toISOString(),
    updated_at: new Date('2026-01-03T00:00:00Z').toISOString(),
  };

  const allAttachments = [
    mockAttachmentActive,
    mockAttachmentQuarantined,
    mockAttachmentPendingDeletion,
  ];

  // 1. Helper formatting tests
  console.log('🧪 1. Testing formatFileSize helper...');
  assert.strictEqual(formatFileSize(0), '0 B');
  assert.strictEqual(formatFileSize(500), '500 B');
  assert.strictEqual(formatFileSize(1024), '1.0 KB');
  assert.strictEqual(formatFileSize(1048576), '1.00 MB');
  console.log('  PASS: formatFileSize verified.');

  // 2. Loading State Skeleton
  console.log('🧪 2. Testing UI State: Loading skeleton...');
  const loadingMarkup = renderToStaticMarkup(
    React.createElement(AttachmentManagementView, { loading: true })
  );
  assert.ok(loadingMarkup.includes('data-testid="attachment-loading-state"'));
  assert.ok(loadingMarkup.includes('Đang tải danh sách tệp đính kèm...'));
  console.log('  PASS: Loading state skeleton verified.');

  // 3. Empty State
  console.log('🧪 3. Testing UI State: Empty state when no attachments...');
  const emptyMarkup = renderToStaticMarkup(
    React.createElement(AttachmentManagementView, {
      attachments: [],
      loading: false,
      canEdit: true,
    })
  );
  assert.ok(emptyMarkup.includes('data-testid="attachment-empty-state"'));
  assert.ok(emptyMarkup.includes('Chưa có tệp đính kèm nào'));
  assert.ok(emptyMarkup.includes('data-testid="empty-upload-button"'));
  assert.ok(emptyMarkup.includes('Tải tệp đầu tiên'));
  console.log('  PASS: Empty state verified.');

  // 4. Attachment List Grid with Multiple Items and Status Badges
  console.log('🧪 4. Testing UI State: Attachment list grid rendering...');
  const listMarkup = renderToStaticMarkup(
    React.createElement(AttachmentManagementView, {
      attachments: allAttachments,
      total: 3,
      loading: false,
      canEdit: true,
      onDownload: async () => {},
      onDelete: async () => {},
      onQuarantine: async () => {},
    })
  );
  assert.ok(listMarkup.includes('data-testid="attachment-list-grid"'));
  assert.ok(
    listMarkup.includes('data-testid="attachment-row-11111111-1111-1111-1111-111111111111"')
  );
  assert.ok(
    listMarkup.includes('data-testid="attachment-row-22222222-2222-2222-2222-222222222222"')
  );
  assert.ok(
    listMarkup.includes('data-testid="attachment-row-33333333-3333-3333-3333-333333333333"')
  );

  // File names & sizes
  assert.ok(listMarkup.includes('damaged_box.png'));
  assert.ok(listMarkup.includes('suspicious_invoice.pdf'));
  assert.ok(listMarkup.includes('old_label.png'));
  assert.ok(listMarkup.includes('1.00 MB'));

  // Status badges
  assert.ok(listMarkup.includes('Hoạt động'));
  assert.ok(listMarkup.includes('Cách ly'));
  assert.ok(listMarkup.includes('Chờ xóa'));

  // Action buttons
  assert.ok(
    listMarkup.includes('data-testid="download-button-11111111-1111-1111-1111-111111111111"')
  );
  assert.ok(
    listMarkup.includes('data-testid="delete-button-11111111-1111-1111-1111-111111111111"')
  );
  assert.ok(
    listMarkup.includes('data-testid="quarantine-button-11111111-1111-1111-1111-111111111111"')
  );
  console.log('  PASS: Attachment list grid and status badges verified.');

  // 5. Upload Modal & Validation Error State
  console.log('🧪 5. Testing UI State: Upload modal with validation error...');
  const uploadValidationMarkup = renderToStaticMarkup(
    React.createElement(AttachmentManagementView, {
      attachments: allAttachments,
      canEdit: true,
      initialUploadOpen: true,
      initialValidationErrors: {
        file_name: 'Tên tệp không được để trống.',
        content_base64: 'Nội dung tệp không được để trống.',
      },
    })
  );
  assert.ok(uploadValidationMarkup.includes('data-testid="upload-attachment-modal"'));
  assert.ok(uploadValidationMarkup.includes('data-testid="attachment-validation-error"'));
  assert.ok(uploadValidationMarkup.includes('Tên tệp không được để trống.'));
  assert.ok(uploadValidationMarkup.includes('Nội dung tệp không được để trống.'));
  assert.ok(uploadValidationMarkup.includes('data-testid="submit-upload-button"'));
  console.log('  PASS: Upload modal and validation errors verified.');

  // 6. Error State with Retry
  console.log('🧪 6. Testing UI State: API error banner with retry button...');
  const errorMarkup = renderToStaticMarkup(
    React.createElement(AttachmentManagementView, {
      attachments: [],
      error: 'Không thể kết nối đến máy chủ lưu trữ S3.',
      onRefresh: () => {},
    })
  );
  assert.ok(errorMarkup.includes('data-testid="attachment-error-state"'));
  assert.ok(errorMarkup.includes('Không thể kết nối đến máy chủ lưu trữ S3.'));
  assert.ok(errorMarkup.includes('Thử lại'));
  console.log('  PASS: Error state with retry verified.');

  // 7. Forbidden / Read-Only State
  console.log('🧪 7. Testing UI State: Forbidden / read-only banner when canEdit=false...');
  const forbiddenMarkup = renderToStaticMarkup(
    React.createElement(AttachmentManagementView, {
      attachments: allAttachments,
      canEdit: false,
    })
  );
  assert.ok(forbiddenMarkup.includes('data-testid="attachment-forbidden-state"'));
  assert.ok(forbiddenMarkup.includes('Bạn đang ở chế độ xem giới hạn'));
  // Mutation triggers must not be present
  assert.ok(!forbiddenMarkup.includes('data-testid="open-upload-modal-button"'));
  assert.ok(!forbiddenMarkup.includes('data-testid="open-purge-modal-button"'));
  console.log('  PASS: Forbidden / read-only state verified.');

  // 8. Success Banner
  console.log('🧪 8. Testing UI State: Success feedback banner...');
  const successMarkup = renderToStaticMarkup(
    React.createElement(AttachmentManagementView, {
      attachments: allAttachments,
      success: 'Tải tệp lên thành công.',
    })
  );
  assert.ok(successMarkup.includes('data-testid="attachment-success-banner"'));
  assert.ok(successMarkup.includes('Tải tệp lên thành công.'));
  console.log('  PASS: Success feedback banner verified.');

  // 9. Bulk-delete partial-failure recovery state (review round 4, Finding 12)
  console.log('🧪 9. Testing UI State: bulk-delete partial-failure banner with retry...');
  const partialFailure: AttachmentBulkActionResult = {
    success: false,
    total: 3,
    success_count: 1,
    failure_count: 2,
    succeeded_ids: ['11111111-1111-1111-1111-111111111111'],
    failed_ids: ['22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333'],
    results: [
      { id: '11111111-1111-1111-1111-111111111111', status: 'SUCCEEDED' },
      { id: '22222222-2222-2222-2222-222222222222', status: 'FAILED', code: 'DELETE_ERROR' },
      {
        id: '33333333-3333-3333-3333-333333333333',
        status: 'FAILED',
        code: 'PURGE_FAILED',
      },
    ],
  };
  const partialFailureMarkup = renderToStaticMarkup(
    React.createElement(AttachmentManagementView, {
      attachments: allAttachments,
      canEdit: true,
      initialBulkPartialFailure: partialFailure,
      onBulkDelete: async () => {},
    })
  );
  assert.ok(partialFailureMarkup.includes('data-testid="attachment-partial-failure-banner"'));
  assert.ok(
    partialFailureMarkup.includes('1 tệp thành công, 2 tệp lỗi')
  );
  assert.ok(
    partialFailureMarkup.includes('22222222-2222-2222-2222-222222222222 — DELETE_ERROR')
  );
  assert.ok(
    partialFailureMarkup.includes('33333333-3333-3333-3333-333333333333 — PURGE_FAILED')
  );
  assert.ok(partialFailureMarkup.includes('data-testid="retry-failed-bulk-delete"'));
  console.log('  PASS: bulk-delete partial-failure recovery state verified.');

  // 10. Full Settings Page integration test
  console.log('🧪 9. Testing UI State: Full AttachmentsSettingsPage integration...');
  const pageMarkup = renderToStaticMarkup(
    React.createElement(
      AuthProvider,
      null,
      React.createElement(AttachmentsSettingsPage, {
        initialAttachments: allAttachments,
        initialTotal: 3,
        initialLoading: false,
        initialCanEdit: true,
      })
    )
  );
  assert.ok(pageMarkup.includes('Quản lý Tệp đính kèm &amp; Bằng chứng'));
  assert.ok(pageMarkup.includes('data-testid="attachment-management-view"'));
  assert.ok(pageMarkup.includes('data-testid="attachment-list-grid"'));
  console.log('  PASS: Full AttachmentsSettingsPage verified.');

  console.log('================================================================');
  console.log('ALL WEB ATTACHMENTS UI STATES TESTS PASSED (100% GREEN)');
  console.log('================================================================');
}

void runAttachmentsWebTestSuite();
