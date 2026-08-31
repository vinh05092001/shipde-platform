import { assertValidMonorepoPackage, createMockId, resolveMonorepoPackage } from './index';
import {
  UserRole,
  PrototypePersona,
  CarrierCode,
  CarrierCapabilityTier,
  ShipmentStatus,
} from '@shipde/contracts';

function testTestkit() {
  // Test mock ID generation
  const id = createMockId('test');
  if (!id.startsWith('test_')) {
    throw new Error('createMockId failed');
  }

  // Test real package export resolution for all workspace packages
  if (!assertValidMonorepoPackage('@shipde/contracts')) {
    throw new Error('assertValidMonorepoPackage failed to resolve @shipde/contracts');
  }
  if (!assertValidMonorepoPackage('@shipde/config')) {
    throw new Error('assertValidMonorepoPackage failed to resolve @shipde/config');
  }
  if (!assertValidMonorepoPackage('@shipde/ui')) {
    throw new Error('assertValidMonorepoPackage failed to resolve @shipde/ui');
  }
  if (!assertValidMonorepoPackage('@shipde/testkit')) {
    throw new Error('assertValidMonorepoPackage failed to resolve @shipde/testkit');
  }

  // Negative tests: fake names must FAIL resolution even with @shipde/ prefix
  if (assertValidMonorepoPackage('@shipde/not-real')) {
    throw new Error('assertValidMonorepoPackage falsely succeeded for fake @shipde/not-real');
  }
  if (assertValidMonorepoPackage('unscoped-package')) {
    throw new Error('assertValidMonorepoPackage falsely succeeded for unscoped package');
  }

  // Verify resolveMonorepoPackage returns valid entrypoint path
  const contractsPath = resolveMonorepoPackage('@shipde/contracts');
  if (!contractsPath || typeof contractsPath !== 'string') {
    throw new Error('resolveMonorepoPackage did not return valid path for @shipde/contracts');
  }

  // Verify canonical UserRole contains exactly the 4 persisted/domain roles
  const canonicalRoleKeys = Object.keys(UserRole).sort();
  const expectedRoleKeys = ['ACCOUNTANT', 'OPS_CSKH', 'OWNER', 'WAREHOUSE'].sort();
  if (JSON.stringify(canonicalRoleKeys) !== JSON.stringify(expectedRoleKeys)) {
    throw new Error(`UserRole keys mismatch: got ${canonicalRoleKeys.join(',')}`);
  }
  if ('BACKOFFICE' in UserRole) {
    throw new Error('BACKOFFICE must not be part of canonical UserRole contract');
  }

  // Verify PrototypePersona models navigation persona
  if (PrototypePersona.BACKOFFICE !== 'BACKOFFICE') {
    throw new Error('PrototypePersona.BACKOFFICE must equal BACKOFFICE');
  }

  // Verify runtime imports and contract values from @shipde/contracts
  if (UserRole.OWNER !== 'OWNER') {
    throw new Error(`Unexpected UserRole.OWNER: ${UserRole.OWNER}`);
  }
  if (CarrierCode.GHN !== 'GHN' || CarrierCode.GHTK !== 'GHTK') {
    throw new Error('Unexpected CarrierCode values');
  }
  if (CarrierCapabilityTier.L0_OBSERVE !== 'L0') {
    throw new Error('Unexpected CarrierCapabilityTier value');
  }
  if (ShipmentStatus.DELIVERED !== 'delivered') {
    throw new Error('Unexpected ShipmentStatus value');
  }

  console.log('✅ @shipde/testkit package export resolution and contract self-tests passed');
}

testTestkit();
