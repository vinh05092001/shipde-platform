import { PipeTransform, Injectable, HttpStatus } from '@nestjs/common';
import { CanonicalApiException, hasForbiddenRoleTextCharacters } from './rbac.service';
import { CreateRoleDto, UpdateRoleDto } from './rbac.dto';

const ALLOWED_ROLE_FIELDS = new Set(['name', 'description', 'permissions']);

/**
 * Validates CreateRoleDto at controller boundary (Finding P2-03).
 * Rejects non-object bodies, unexpected extra fields, and format violations with 400 field errors.
 */
@Injectable()
export class CreateRolePipe implements PipeTransform<any, CreateRoleDto> {
  transform(value: any): CreateRoleDto {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Dữ liệu yêu cầu không hợp lệ',
        false,
        'Vui lòng gửi đối tượng JSON hợp lệ',
        [{ field: 'body', code: 'INVALID_BODY', message: 'Dữ liệu yêu cầu phải là đối tượng JSON' }]
      );
    }

    // Extra unexpected fields rejection
    const extraFields = Object.keys(value).filter((k) => !ALLOWED_ROLE_FIELDS.has(k));
    if (extraFields.length > 0) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        `Trường không được hỗ trợ: ${extraFields.join(', ')}`,
        false,
        'Vui lòng loại bỏ các trường không hợp lệ',
        extraFields.map((f) => ({
          field: f,
          code: 'UNEXPECTED_FIELD',
          message: `Trường '${f}' không được hỗ trợ`,
        }))
      );
    }

    // Name validation
    if (typeof value.name !== 'string' || value.name.trim().length === 0) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Tên vai trò là bắt buộc',
        false,
        'Vui lòng nhập tên vai trò hợp lệ',
        [{ field: 'name', code: 'REQUIRED', message: 'Tên vai trò không được để trống' }]
      );
    }

    if (value.name.trim().length > 255) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Tên vai trò không được vượt quá 255 ký tự',
        false,
        'Vui lòng nhập tên vai trò ngắn hơn 255 ký tự',
        [
          {
            field: 'name',
            code: 'MAX_LENGTH',
            message: 'Tên vai trò không được vượt quá 255 ký tự',
          },
        ]
      );
    }

    if (hasForbiddenRoleTextCharacters(value.name)) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Tên vai trò không được chứa ký tự <, > hoặc ký tự điều khiển',
        false,
        'Vui lòng nhập tên vai trò hợp lệ không chứa ký tự đặc biệt',
        [
          {
            field: 'name',
            code: 'INVALID_CHARACTERS',
            message: 'Tên vai trò không được chứa ký tự <, > hoặc ký tự điều khiển',
          },
        ]
      );
    }

    // Description validation
    if (value.description !== undefined && value.description !== null) {
      if (typeof value.description !== 'string') {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'Mô tả vai trò phải là chuỗi ký tự',
          false,
          'Vui lòng nhập mô tả hợp lệ',
          [
            {
              field: 'description',
              code: 'INVALID_TYPE',
              message: 'Mô tả vai trò phải là chuỗi ký tự',
            },
          ]
        );
      }
      if (value.description.length > 1000) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'Mô tả vai trò không được vượt quá 1000 ký tự',
          false,
          'Vui lòng nhập mô tả ngắn hơn 1000 ký tự',
          [
            {
              field: 'description',
              code: 'MAX_LENGTH',
              message: 'Mô tả vai trò không được vượt quá 1000 ký tự',
            },
          ]
        );
      }
      if (hasForbiddenRoleTextCharacters(value.description)) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'Mô tả vai trò không được chứa ký tự <, > hoặc ký tự điều khiển',
          false,
          'Vui lòng nhập mô tả hợp lệ không chứa ký tự đặc biệt',
          [
            {
              field: 'description',
              code: 'INVALID_CHARACTERS',
              message: 'Mô tả vai trò không được chứa ký tự <, > hoặc ký tự điều khiển',
            },
          ]
        );
      }
    }

    // Permissions validation
    if (!value.permissions || !Array.isArray(value.permissions) || value.permissions.length === 0) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Cần chọn ít nhất một quyền hạn',
        false,
        'Vui lòng chọn ít nhất một quyền hạn từ danh mục',
        [{ field: 'permissions', code: 'REQUIRED', message: 'Danh sách quyền không được để trống' }]
      );
    }
    if (value.permissions.length > 50) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Danh sách quyền hạn không được vượt quá 50 mục',
        false,
        'Vui lòng chọn tối đa 50 quyền hạn',
        [
          {
            field: 'permissions',
            code: 'MAX_ITEMS',
            message: 'Danh sách quyền hạn không được vượt quá 50 mục',
          },
        ]
      );
    }
    for (let i = 0; i < value.permissions.length; i++) {
      if (typeof value.permissions[i] !== 'string' || value.permissions[i].trim().length === 0) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'Mã quyền hạn phải là chuỗi ký tự hợp lệ',
          false,
          'Vui lòng kiểm tra lại danh sách quyền hạn',
          [
            {
              field: `permissions[${i}]`,
              code: 'INVALID_TYPE',
              message: 'Mã quyền hạn phải là chuỗi ký tự',
            },
          ]
        );
      }
    }

    return value as CreateRoleDto;
  }
}

/**
 * Validates UpdateRoleDto at controller boundary (Finding P2-03).
 * Rejects non-object bodies, unexpected extra fields, and format violations with 400 field errors.
 */
@Injectable()
export class UpdateRolePipe implements PipeTransform<any, UpdateRoleDto> {
  transform(value: any): UpdateRoleDto {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        'Dữ liệu yêu cầu không hợp lệ',
        false,
        'Vui lòng gửi đối tượng JSON hợp lệ',
        [{ field: 'body', code: 'INVALID_BODY', message: 'Dữ liệu yêu cầu phải là đối tượng JSON' }]
      );
    }

    // Extra unexpected fields rejection
    const extraFields = Object.keys(value).filter((k) => !ALLOWED_ROLE_FIELDS.has(k));
    if (extraFields.length > 0) {
      throw new CanonicalApiException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_ERROR',
        `Trường không được hỗ trợ: ${extraFields.join(', ')}`,
        false,
        'Vui lòng loại bỏ các trường không hợp lệ',
        extraFields.map((f) => ({
          field: f,
          code: 'UNEXPECTED_FIELD',
          message: `Trường '${f}' không được hỗ trợ`,
        }))
      );
    }

    if (value.name !== undefined) {
      if (typeof value.name !== 'string' || value.name.trim().length === 0) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'Tên vai trò không được để trống',
          false,
          undefined,
          [{ field: 'name', code: 'REQUIRED', message: 'Tên vai trò không được để trống' }]
        );
      }
      if (value.name.trim().length > 255) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'Tên vai trò không được vượt quá 255 ký tự',
          false,
          undefined,
          [
            {
              field: 'name',
              code: 'MAX_LENGTH',
              message: 'Tên vai trò không được vượt quá 255 ký tự',
            },
          ]
        );
      }
      if (hasForbiddenRoleTextCharacters(value.name)) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'Tên vai trò không được chứa ký tự <, > hoặc ký tự điều khiển',
          false,
          'Vui lòng nhập tên vai trò hợp lệ không chứa ký tự đặc biệt',
          [
            {
              field: 'name',
              code: 'INVALID_CHARACTERS',
              message: 'Tên vai trò không được chứa ký tự <, > hoặc ký tự điều khiển',
            },
          ]
        );
      }
    }

    if (value.description !== undefined && value.description !== null) {
      if (typeof value.description !== 'string') {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'Mô tả vai trò phải là chuỗi ký tự',
          false,
          'Vui lòng nhập mô tả hợp lệ',
          [
            {
              field: 'description',
              code: 'INVALID_TYPE',
              message: 'Mô tả vai trò phải là chuỗi ký tự',
            },
          ]
        );
      }
      if (value.description.length > 1000) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'Mô tả vai trò không được vượt quá 1000 ký tự',
          false,
          'Vui lòng nhập mô tả ngắn hơn 1000 ký tự',
          [
            {
              field: 'description',
              code: 'MAX_LENGTH',
              message: 'Mô tả vai trò không được vượt quá 1000 ký tự',
            },
          ]
        );
      }
      if (hasForbiddenRoleTextCharacters(value.description)) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'Mô tả vai trò không được chứa ký tự <, > hoặc ký tự điều khiển',
          false,
          'Vui lòng nhập mô tả hợp lệ không chứa ký tự đặc biệt',
          [
            {
              field: 'description',
              code: 'INVALID_CHARACTERS',
              message: 'Mô tả vai trò không được chứa ký tự <, > hoặc ký tự điều khiển',
            },
          ]
        );
      }
    }

    if (value.permissions !== undefined) {
      if (!Array.isArray(value.permissions) || value.permissions.length === 0) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'Cần chọn ít nhất một quyền hạn',
          false,
          undefined,
          [
            {
              field: 'permissions',
              code: 'REQUIRED',
              message: 'Danh sách quyền không được để trống',
            },
          ]
        );
      }
      if (value.permissions.length > 50) {
        throw new CanonicalApiException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_ERROR',
          'Danh sách quyền hạn không được vượt quá 50 mục',
          false,
          'Vui lòng chọn tối đa 50 quyền hạn',
          [
            {
              field: 'permissions',
              code: 'MAX_ITEMS',
              message: 'Danh sách quyền hạn không được vượt quá 50 mục',
            },
          ]
        );
      }
      for (let i = 0; i < value.permissions.length; i++) {
        if (typeof value.permissions[i] !== 'string' || value.permissions[i].trim().length === 0) {
          throw new CanonicalApiException(
            HttpStatus.BAD_REQUEST,
            'VALIDATION_ERROR',
            'Mã quyền hạn phải là chuỗi ký tự hợp lệ',
            false,
            'Vui lòng kiểm tra lại danh sách quyền hạn',
            [
              {
                field: `permissions[${i}]`,
                code: 'INVALID_TYPE',
                message: 'Mã quyền hạn phải là chuỗi ký tự',
              },
            ]
          );
        }
      }
    }

    return value as UpdateRoleDto;
  }
}
