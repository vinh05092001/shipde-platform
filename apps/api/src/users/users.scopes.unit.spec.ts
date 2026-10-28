import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { HttpStatus } from '@nestjs/common';
import { validateScopeArray, enforceScopePrivilegeCeiling, UsersService } from './users.service';
import { CanonicalApiException } from '../auth/auth.service';
import { RoleEnum } from '@prisma/client';

describe('FEAT-RBAC-02 Scope Assignment Unit Tests', () => {
  describe('validateScopeArray', () => {
    it('accepts valid string array within limits', () => {
      assert.doesNotThrow(() => {
        validateScopeArray(['store-1', 'store-2', '*'], 'store_scopes');
      });
    });

    it('accepts undefined or null scopes', () => {
      assert.doesNotThrow(() => {
        validateScopeArray(undefined, 'warehouse_scopes');
        validateScopeArray(null, 'carrier_account_scopes');
      });
    });

    it('rejects non-array payloads with 400 VALIDATION_ERROR', () => {
      assert.throws(
        () => {
          validateScopeArray('not-an-array' as any, 'store_scopes');
        },
        (err: any) => {
          assert.strictEqual(err.getStatus(), HttpStatus.BAD_REQUEST);
          assert.strictEqual(err.code, 'VALIDATION_ERROR');
          assert.strictEqual(err.fields?.[0]?.code, 'INVALID_TYPE');
          return true;
        }
      );
    });

    it('rejects arrays exceeding max count (50) with 400 VALIDATION_ERROR', () => {
      const oversized = Array.from({ length: 51 }, (_, i) => `scope-${i}`);
      assert.throws(
        () => {
          validateScopeArray(oversized, 'warehouse_scopes');
        },
        (err: any) => {
          assert.strictEqual(err.getStatus(), HttpStatus.BAD_REQUEST);
          assert.strictEqual(err.code, 'VALIDATION_ERROR');
          assert.strictEqual(err.fields?.[0]?.code, 'ARRAY_TOO_LONG');
          return true;
        }
      );
    });

    it('rejects non-string array elements with 400 VALIDATION_ERROR', () => {
      assert.throws(
        () => {
          validateScopeArray(['valid-scope', 12345 as any], 'carrier_account_scopes');
        },
        (err: any) => {
          assert.strictEqual(err.getStatus(), HttpStatus.BAD_REQUEST);
          assert.strictEqual(err.code, 'VALIDATION_ERROR');
          assert.strictEqual(err.fields?.[0]?.code, 'INVALID_TYPE');
          return true;
        }
      );
    });

    it('rejects empty string elements with 400 VALIDATION_ERROR', () => {
      assert.throws(
        () => {
          validateScopeArray(['valid-scope', '   '], 'store_scopes');
        },
        (err: any) => {
          assert.strictEqual(err.getStatus(), HttpStatus.BAD_REQUEST);
          assert.strictEqual(err.code, 'VALIDATION_ERROR');
          assert.strictEqual(err.fields?.[0]?.code, 'EMPTY_STRING');
          return true;
        }
      );
    });

    it('rejects string elements exceeding max length (64) with 400 VALIDATION_ERROR', () => {
      const longString = 's'.repeat(65);
      assert.throws(
        () => {
          validateScopeArray([longString], 'warehouse_scopes');
        },
        (err: any) => {
          assert.strictEqual(err.getStatus(), HttpStatus.BAD_REQUEST);
          assert.strictEqual(err.code, 'VALIDATION_ERROR');
          assert.strictEqual(err.fields?.[0]?.code, 'STRING_TOO_LONG');
          return true;
        }
      );
    });

    it('rejects elements with dangerous characters (<, >, control chars) with 400 VALIDATION_ERROR', () => {
      assert.throws(
        () => {
          validateScopeArray(['<script>alert(1)</script>'], 'store_scopes');
        },
        (err: any) => {
          assert.strictEqual(err.getStatus(), HttpStatus.BAD_REQUEST);
          assert.strictEqual(err.code, 'VALIDATION_ERROR');
          assert.strictEqual(err.fields?.[0]?.code, 'INVALID_CHARACTERS');
          return true;
        }
      );
    });
  });

  describe('enforceScopePrivilegeCeiling', () => {
    it('allows Owner to assign any store, warehouse, and carrier scopes', () => {
      const ownerActor = {
        role: RoleEnum.OWNER,
        store_scopes: ['store-1'],
        warehouse_scopes: ['wh-1'],
        carrier_account_scopes: ['ca-1'],
      };

      assert.doesNotThrow(() => {
        enforceScopePrivilegeCeiling(
          {
            store_scopes: ['*'],
            warehouse_scopes: ['wh-other', 'wh-2'],
            carrier_account_scopes: ['*'],
          },
          ownerActor
        );
      });
    });

    it('allows non-owner to assign scopes within their granted ceiling', () => {
      const managerActor = {
        role: RoleEnum.OPS_CSKH,
        store_scopes: ['store-1', 'store-2'],
        warehouse_scopes: ['wh-1'],
        carrier_account_scopes: ['ca-1'],
      };

      assert.doesNotThrow(() => {
        enforceScopePrivilegeCeiling(
          {
            store_scopes: ['store-1'],
            warehouse_scopes: ['wh-1'],
            carrier_account_scopes: ['ca-1'],
          },
          managerActor
        );
      });
    });

    it('allows non-owner with wildcard store scope to assign any store or wildcard', () => {
      const wildcardStoreActor = {
        role: RoleEnum.OPS_CSKH,
        store_scopes: ['*'],
        warehouse_scopes: ['wh-1'],
        carrier_account_scopes: ['ca-1'],
      };

      assert.doesNotThrow(() => {
        enforceScopePrivilegeCeiling(
          {
            store_scopes: ['*'],
            warehouse_scopes: ['wh-1'],
          },
          wildcardStoreActor
        );
      });
    });

    it('denies non-owner from assigning store wildcard (*) when they lack wildcard', () => {
      const restrictedActor = {
        role: RoleEnum.OPS_CSKH,
        store_scopes: ['store-1'],
        warehouse_scopes: ['wh-1'],
        carrier_account_scopes: ['ca-1'],
      };

      assert.throws(
        () => {
          enforceScopePrivilegeCeiling({ store_scopes: ['*'] }, restrictedActor);
        },
        (err: any) => {
          assert.strictEqual(err.getStatus(), HttpStatus.FORBIDDEN);
          assert.strictEqual(err.code, 'PRIVILEGE_ESCALATION_DENIED');
          return true;
        }
      );
    });

    it('denies non-owner from assigning a store they do not possess', () => {
      const restrictedActor = {
        role: RoleEnum.OPS_CSKH,
        store_scopes: ['store-1'],
        warehouse_scopes: ['wh-1'],
        carrier_account_scopes: ['ca-1'],
      };

      assert.throws(
        () => {
          enforceScopePrivilegeCeiling(
            { store_scopes: ['store-1', 'store-unauthorized'] },
            restrictedActor
          );
        },
        (err: any) => {
          assert.strictEqual(err.getStatus(), HttpStatus.FORBIDDEN);
          assert.strictEqual(err.code, 'PRIVILEGE_ESCALATION_DENIED');
          return true;
        }
      );
    });

    it('denies non-owner from assigning warehouse scope outside their ceiling', () => {
      const restrictedActor = {
        role: RoleEnum.WAREHOUSE,
        store_scopes: [],
        warehouse_scopes: ['wh-north'],
        carrier_account_scopes: [],
      };

      assert.throws(
        () => {
          enforceScopePrivilegeCeiling({ warehouse_scopes: ['wh-south'] }, restrictedActor);
        },
        (err: any) => {
          assert.strictEqual(err.getStatus(), HttpStatus.FORBIDDEN);
          assert.strictEqual(err.code, 'PRIVILEGE_ESCALATION_DENIED');
          return true;
        }
      );
    });

    it('denies non-owner from assigning carrier account scope outside their ceiling', () => {
      const restrictedActor = {
        role: RoleEnum.OPS_CSKH,
        store_scopes: ['*'],
        warehouse_scopes: ['*'],
        carrier_account_scopes: ['ca-ghn-01'],
      };

      assert.throws(
        () => {
          enforceScopePrivilegeCeiling({ carrier_account_scopes: ['ca-ghtk-02'] }, restrictedActor);
        },
        (err: any) => {
          assert.strictEqual(err.getStatus(), HttpStatus.FORBIDDEN);
          assert.strictEqual(err.code, 'PRIVILEGE_ESCALATION_DENIED');
          return true;
        }
      );
    });
  });

  describe('validateCarrierAccountScopes', () => {
    it('passes when carrierAccountScopes is undefined, empty, or wildcard (*)', async () => {
      const mockPrisma = {
        carrierAccount: {
          findMany: async () => [],
        },
      } as any;
      const svc = new UsersService(mockPrisma, {} as any);

      await assert.doesNotReject(svc.validateCarrierAccountScopes(undefined, 'm-1'));
      await assert.doesNotReject(svc.validateCarrierAccountScopes([], 'm-1'));
      await assert.doesNotReject(svc.validateCarrierAccountScopes(['*'], 'm-1'));
    });

    it('passes when all concrete carrier account IDs exist in merchant', async () => {
      const mockPrisma = {
        carrierAccount: {
          findMany: async (args: any) => {
            assert.strictEqual(args.where.merchant_id, 'm-1');
            return [{ id: 'ca-1' }, { id: 'ca-2' }];
          },
        },
      } as any;
      const svc = new UsersService(mockPrisma, {} as any);

      await assert.doesNotReject(svc.validateCarrierAccountScopes(['ca-1', 'ca-2'], 'm-1'));
    });

    it('throws 400 VALIDATION_ERROR when carrier account does not exist in merchant', async () => {
      const mockPrisma = {
        carrierAccount: {
          findMany: async () => [{ id: 'ca-1' }],
        },
      } as any;
      const svc = new UsersService(mockPrisma, {} as any);

      await assert.rejects(
        svc.validateCarrierAccountScopes(['ca-1', 'ca-unregistered'], 'm-1'),
        (err: any) => {
          assert.strictEqual(err.getStatus(), HttpStatus.BAD_REQUEST);
          assert.strictEqual(err.code, 'VALIDATION_ERROR');
          assert.strictEqual(err.fields?.[0]?.code, 'INVALID_CARRIER_ACCOUNT');
          return true;
        }
      );
    });
  });
});
