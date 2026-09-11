import * as fs from 'fs';
import * as path from 'path';
import openapiTS, { astToString } from 'openapi-typescript';
import yaml from 'js-yaml';

export const OPENAPI_SPEC_PATH = path.resolve(
  process.cwd(),
  'docs/product-spec/contracts/openapi.yaml'
);
export const GENERATED_TYPES_PATH = path.resolve(
  process.cwd(),
  'packages/contracts/src/openapi.ts'
);

export const REQUIRED_CANONICAL_PATHS = [
  '/health/live',
  '/health/ready',
  '/auth/login',
  '/me',
  '/shops',
  '/carrier-accounts',
  '/orders',
  '/shipments',
  '/shipments/{id}/tracking',
  '/audit-periods',
];

export interface ContractValidationResult {
  valid: boolean;
  driftDetected: boolean;
  errors: string[];
  specVersion?: string;
  pathsCount?: number;
}

export async function validateOpenApiSpec(
  specPath: string = OPENAPI_SPEC_PATH
): Promise<{ valid: boolean; errors: string[]; spec?: any }> {
  const errors: string[] = [];
  if (!fs.existsSync(specPath)) {
    errors.push(`OpenAPI spec file not found at: ${specPath}`);
    return { valid: false, errors };
  }

  let spec: any;
  try {
    const rawContent = fs.readFileSync(specPath, 'utf8');
    spec = yaml.load(rawContent);
  } catch (err: any) {
    errors.push(`Failed to parse YAML in ${specPath}: ${err.message}`);
    return { valid: false, errors };
  }

  if (!spec || typeof spec !== 'object') {
    errors.push(`OpenAPI spec must be an object.`);
    return { valid: false, errors };
  }

  if (!spec.openapi || !String(spec.openapi).startsWith('3.')) {
    errors.push(`Spec must be OpenAPI 3.x, found: ${spec.openapi}`);
  }

  if (!spec.info || !spec.info.title) {
    errors.push(`Spec is missing required info.title.`);
  }

  if (!spec.paths || typeof spec.paths !== 'object') {
    errors.push(`Spec is missing required 'paths' object.`);
  } else {
    for (const reqPath of REQUIRED_CANONICAL_PATHS) {
      if (!spec.paths[reqPath]) {
        errors.push(`Missing required canonical route in openapi.yaml: ${reqPath}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    spec,
  };
}

import { pathToFileURL } from 'url';
import * as prettier from 'prettier';

export async function generateOpenApiTypes(specPath: string = OPENAPI_SPEC_PATH): Promise<string> {
  const fileUrl = pathToFileURL(path.resolve(specPath));
  const ast = await openapiTS(fileUrl);
  const raw = astToString(ast);
  const prettierConfig = (await prettier.resolveConfig(GENERATED_TYPES_PATH)) || {};
  return prettier.format(raw, {
    ...prettierConfig,
    parser: 'typescript',
    filepath: GENERATED_TYPES_PATH,
  });
}

export async function checkContractDrift(
  specPath: string = OPENAPI_SPEC_PATH,
  generatedPath: string = GENERATED_TYPES_PATH
): Promise<{ drift: boolean; error?: string }> {
  if (!fs.existsSync(generatedPath)) {
    return {
      drift: true,
      error: `Generated contract types file does not exist at ${generatedPath}`,
    };
  }

  try {
    const freshGenerated = await generateOpenApiTypes(specPath);
    const existingContent = fs.readFileSync(generatedPath, 'utf8');

    // Normalize line endings and trailing whitespace for comparison
    const normFresh = freshGenerated.replace(/\r\n/g, '\n').trim();
    const normExisting = existingContent.replace(/\r\n/g, '\n').trim();

    if (normFresh !== normExisting) {
      return {
        drift: true,
        error: `Contract drift detected! packages/contracts/src/openapi.ts does not match docs/product-spec/contracts/openapi.yaml. Run 'pnpm contract:generate' to update.`,
      };
    }

    return { drift: false };
  } catch (err: any) {
    return {
      drift: true,
      error: `Error checking contract drift: ${err.message}`,
    };
  }
}

export async function runContractVerification(): Promise<ContractValidationResult> {
  const specResult = await validateOpenApiSpec();
  if (!specResult.valid) {
    return {
      valid: false,
      driftDetected: false,
      errors: specResult.errors,
    };
  }

  const driftResult = await checkContractDrift();
  const errors: string[] = [];
  if (driftResult.drift && driftResult.error) {
    errors.push(driftResult.error);
  }

  return {
    valid: errors.length === 0,
    driftDetected: driftResult.drift,
    errors,
    specVersion: specResult.spec?.openapi,
    pathsCount: Object.keys(specResult.spec?.paths || {}).length,
  };
}

// CLI entry point
if (process.argv[1] && process.argv[1].endsWith('verify-contracts.ts')) {
  const isGenerate = process.argv.includes('--generate');

  (async () => {
    console.log('================================================================');
    console.log('📜 SHIP DỄ — BỘ KIỂM SOÁT VÀ KIỂM TOÁN HỢP ĐỒNG (OPENAPI CONTRACT GATE)');
    console.log('================================================================');

    if (isGenerate) {
      console.log(`Đang sinh TypeScript types từ ${OPENAPI_SPEC_PATH}...`);
      const generated = await generateOpenApiTypes();
      fs.writeFileSync(GENERATED_TYPES_PATH, generated, 'utf8');
      console.log(`✅ Đã đồng bộ hợp đồng vào: ${GENERATED_TYPES_PATH}`);
      process.exit(0);
    }

    const result = await runContractVerification();
    if (!result.valid) {
      console.error('\n❌ PHÁT HIỆN LỖI HỢP ĐỒNG HOẶC DRIFT CONTRACT:');
      for (const err of result.errors) {
        console.error(` - ${err}`);
      }
      process.exit(1);
    }

    console.log(`\n✅ OpenAPI Spec Version: ${result.specVersion}`);
    console.log(`✅ Tổng số endpoints đã xác thực: ${result.pathsCount}`);
    console.log(
      '✅ Hợp đồng TypeScript (@shipde/contracts) đồng bộ 100% với openapi.yaml (Không có drift).'
    );
    process.exit(0);
  })().catch((err) => {
    console.error(`Unhandled error: ${err.message}`);
    process.exit(1);
  });
}
