import { assertValidMonorepoPackage, createMockId } from './index';

function testTestkit() {
  const id = createMockId('test');
  if (!id.startsWith('test_')) {
    throw new Error('createMockId failed');
  }

  if (!assertValidMonorepoPackage('@shipde/contracts')) {
    throw new Error('assertValidMonorepoPackage failed for @shipde/contracts');
  }

  if (assertValidMonorepoPackage('unscoped-package')) {
    throw new Error('assertValidMonorepoPackage failed for unscoped package');
  }

  console.log('✅ @shipde/testkit package self-test passed');
}

testTestkit();
