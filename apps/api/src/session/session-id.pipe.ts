import { PipeTransform, Injectable, NotFoundException } from '@nestjs/common';

@Injectable()
export class SessionIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      throw new NotFoundException({
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Không tìm thấy phiên làm việc',
          retryable: false,
        },
      });
    }
    return value;
  }
}
