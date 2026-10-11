// 운영체제 열쇠로 하는 암호화 (Electron safeStorage). secret-file.ts 가 쓴다.
import { app, safeStorage } from 'electron';
import type { SecretCrypto } from './secret-file.ts';

/** 준비(ready) 전이거나 리눅스에서 열쇠고리가 없으면(basic_text, 고정 열쇠라 암호화가 아니다) 쓰지 않는다 */
export const osCrypto: SecretCrypto = {
  available() {
    try {
      if (!app.isReady() || !safeStorage.isEncryptionAvailable()) return false;
      if (process.platform === 'linux') {
        const backend = safeStorage.getSelectedStorageBackend();
        if (backend === 'basic_text' || backend === 'unknown') return false;
      }
      return true;
    } catch {
      return false;
    }
  },
  encrypt: (text) => safeStorage.encryptString(text),
  decrypt: (data) => safeStorage.decryptString(data),
};
