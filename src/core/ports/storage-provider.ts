export type StoredObject = {
  uri: string;
  key: string;
  size?: number;
  mimeType?: string;
};

export interface StorageProvider {
  put(
    key: string,
    data: Buffer | Uint8Array,
    mimeType?: string,
  ): Promise<StoredObject>;

  delete(key: string): Promise<void>;

  getUrl(key: string): Promise<string>;
}