/**
 * Storage/media compat pack, node half: the file-system shim's virtual
 * filesystem seen through BOTH SDK 57 APIs, its localStorage backing and quota
 * failure, its fetch-backed transfers, and the media-library shim's
 * permanently-empty library.
 *
 * Runs in the default node environment, where `localStorage` is genuinely
 * absent unless a test stubs one — which is exactly the SSR/privacy-mode path
 * the shim has to survive, so every test below that does not stub storage is
 * also a test of the in-memory fallback.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  __resetFileSystem,
  cacheDirectory,
  copyAsync,
  deleteAsync,
  Directory,
  documentDirectory,
  downloadAsync,
  EncodingType,
  File,
  FileSystemUploadType,
  getFreeDiskStorageAsync,
  getInfoAsync,
  getTotalDiskCapacityAsync,
  makeDirectoryAsync,
  moveAsync,
  Paths,
  readAsStringAsync,
  readDirectoryAsync,
  uploadAsync,
  writeAsStringAsync,
} from '../../compat/src/file-system';
import * as MediaLibrary from '../../compat/src/media-library';
import { manipulateAsync, SaveFormat } from '../../compat/src/image-manipulator';

/** A localStorage stand-in; `limit` triggers the browser's quota failure. */
function makeStorage(limit = Infinity): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      let used = v.length;
      for (const [key, value] of map) if (key !== k) used += value.length;
      if (used > limit) throw Object.assign(new Error('exceeded the quota'), { name: 'QuotaExceededError' });
      map.set(k, v);
    },
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as Storage & { map: Map<string, string> };
}

beforeEach(() => {
  __resetFileSystem();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  __resetFileSystem();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('file-system compat shim: one filesystem, two APIs', () => {
  test('a legacy write is visible to File, and a File write is visible to the legacy readers', async () => {
    await writeAsStringAsync(`${cacheDirectory}note.txt`, 'hello');

    const file = new File(Paths.cache, 'note.txt');
    expect(file.exists).toBe(true);
    expect(file.uri).toBe(`${cacheDirectory}note.txt`);
    expect(file.name).toBe('note.txt');
    expect(file.extension).toBe('.txt');
    expect(file.textSync()).toBe('hello');
    expect(await file.text()).toBe('hello');

    file.write(' world', { append: true });
    expect(await readAsStringAsync(`${cacheDirectory}note.txt`)).toBe('hello world');
    expect(file.size).toBe(11);

    const created = new File(Paths.document, 'a.json');
    created.create();
    created.write(JSON.stringify({ a: 1 }));
    expect(await readAsStringAsync(`${documentDirectory}a.json`)).toBe('{"a":1}');
    expect(await created.json()).toEqual({ a: 1 });

    const info = await getInfoAsync(`${documentDirectory}a.json`);
    expect(info).toMatchObject({ exists: true, isDirectory: false, uri: `${documentDirectory}a.json`, size: 7 });
    // The legacy surface reports seconds, so it must be far smaller than Date.now().
    expect(info.modificationTime).toBeLessThan(Date.now() / 100);
  });

  test('getInfoAsync resolves {exists:false} for a missing path instead of throwing', async () => {
    expect(await getInfoAsync(`${cacheDirectory}nothing.txt`)).toEqual({
      exists: false,
      uri: `${cacheDirectory}nothing.txt`,
      isDirectory: false,
    });
    // Not a VFS entry at all — still an answer, not a throw.
    expect(await getInfoAsync('blob:http://localhost/abc')).toMatchObject({ exists: false });
  });

  test('utf8 and base64 encodings both round-trip, and bytes survive verbatim', async () => {
    await writeAsStringAsync(`${cacheDirectory}utf8.txt`, 'héllo → 🌍');
    expect(new File(Paths.cache, 'utf8.txt').textSync()).toBe('héllo → 🌍');

    const bytes = new Uint8Array([0, 1, 2, 127, 128, 253, 254, 255]);
    const binary = new File(Paths.cache, 'blob.bin');
    binary.create();
    binary.write(bytes);
    expect(Array.from(binary.bytesSync())).toEqual(Array.from(bytes));
    expect(binary.size).toBe(8);

    const base64 = await readAsStringAsync(`${cacheDirectory}blob.bin`, { encoding: EncodingType.Base64 });
    expect(base64).toBe(Buffer.from(bytes).toString('base64'));
    expect(await binary.base64()).toBe(base64);

    await writeAsStringAsync(`${cacheDirectory}copy.bin`, base64, { encoding: EncodingType.Base64 });
    expect(Array.from(new File(Paths.cache, 'copy.bin').bytesSync())).toEqual(Array.from(bytes));

    // Documented base64 windowing.
    const window = await readAsStringAsync(`${cacheDirectory}blob.bin`, {
      encoding: EncodingType.Base64,
      position: 2,
      length: 3,
    });
    expect(Array.from(Buffer.from(window, 'base64'))).toEqual([2, 127, 128]);
  });

  test('directories list their direct children and delete recursively', async () => {
    await makeDirectoryAsync(`${documentDirectory}media/thumbs`, { intermediates: true });
    await writeAsStringAsync(`${documentDirectory}media/thumbs/a.txt`, 'a');
    await writeAsStringAsync(`${documentDirectory}media/b.txt`, 'bb');

    expect(await readDirectoryAsync(`${documentDirectory}media`)).toEqual(['b.txt', 'thumbs']);

    const dir = new Directory(Paths.document, 'media');
    expect(dir.exists).toBe(true);
    expect(dir.uri).toBe(`${documentDirectory}media/`);
    const entries = dir.list();
    expect(entries.map((entry) => entry.name)).toEqual(['b.txt', 'thumbs']);
    expect(entries.map((entry) => entry instanceof Directory)).toEqual([false, true]);
    // Recursive byte total: 'bb' + 'a'.
    expect(dir.size).toBe(3);
    expect(dir.info().files).toEqual(['b.txt', 'thumbs']);

    await deleteAsync(`${documentDirectory}media`);
    expect(dir.exists).toBe(false);
    expect((await getInfoAsync(`${documentDirectory}media/thumbs/a.txt`)).exists).toBe(false);
    expect(await readDirectoryAsync(documentDirectory)).toEqual([]);
  });

  test('copy and move cross the two APIs, and move updates the object handle', async () => {
    await writeAsStringAsync(`${cacheDirectory}src.txt`, 'payload');
    await copyAsync({ from: `${cacheDirectory}src.txt`, to: `${documentDirectory}copy.txt` });
    expect(new File(Paths.document, 'copy.txt').textSync()).toBe('payload');

    await moveAsync({ from: `${documentDirectory}copy.txt`, to: `${documentDirectory}moved.txt` });
    expect((await getInfoAsync(`${documentDirectory}copy.txt`)).exists).toBe(false);
    expect(await readAsStringAsync(`${documentDirectory}moved.txt`)).toBe('payload');

    const handle = new File(Paths.document, 'moved.txt');
    handle.rename('renamed.txt');
    expect(handle.uri).toBe(`${documentDirectory}renamed.txt`);
    expect(handle.textSync()).toBe('payload');

    // Copying INTO a directory keeps the source's own name, as upstream does.
    await makeDirectoryAsync(`${documentDirectory}bucket`);
    handle.copySync(new Directory(Paths.document, 'bucket'));
    expect(await readAsStringAsync(`${documentDirectory}bucket/renamed.txt`)).toBe('payload');
  });

  test('a write into a directory that does not exist fails loudly', () => {
    expect(() => new File(Paths.document, 'nope', 'x.txt').create()).toThrow(/does not exist/);
    // ...and says how to fix it.
    expect(() => new File(Paths.document, 'nope', 'x.txt').create()).toThrow(/intermediates/);
    new File(Paths.document, 'nope', 'x.txt').create({ intermediates: true });
    expect(new File(Paths.document, 'nope', 'x.txt').exists).toBe(true);
  });

  test('a file handle seeks and reads slices without loading the whole file', () => {
    const file = new File(Paths.cache, 'chunks.bin');
    file.create();
    file.write(new Uint8Array([10, 11, 12, 13, 14, 15]));

    const handle = file.open();
    expect(handle.size).toBe(6);
    handle.offset = 2;
    expect(Array.from(handle.readBytes(3))).toEqual([12, 13, 14]);
    expect(handle.offset).toBe(5);
    handle.close();
    expect(() => handle.readBytes(1)).toThrow(/closed file handle/);
  });

  test('watchers observe mutations made through either API', async () => {
    await makeDirectoryAsync(`${documentDirectory}watched`);
    const events: string[] = [];
    const subscription = new Directory(Paths.document, 'watched').watch(
      (event) => events.push(`${event.type}:${event.target.name}`),
      { debounce: 0 }
    );

    await writeAsStringAsync(`${documentDirectory}watched/one.txt`, '1');
    new File(Paths.document, 'watched', 'one.txt').write('2');
    await deleteAsync(`${documentDirectory}watched/one.txt`);
    subscription.remove();
    await writeAsStringAsync(`${documentDirectory}watched/two.txt`, '2');

    expect(events).toEqual(['created:one.txt', 'modified:one.txt', 'deleted:one.txt']);
  });
});

describe('file-system compat shim: backing store', () => {
  test('with no localStorage the store still round-trips in memory', async () => {
    expect(typeof localStorage).toBe('undefined');
    await writeAsStringAsync(`${cacheDirectory}memory.txt`, 'in-realm only');
    expect(new File(Paths.cache, 'memory.txt').textSync()).toBe('in-realm only');
    expect(await readDirectoryAsync(cacheDirectory)).toEqual(['memory.txt']);
  });

  test('with localStorage the contents land in the namespaced keys', async () => {
    const storage = makeStorage();
    vi.stubGlobal('localStorage', storage);

    await writeAsStringAsync(`${cacheDirectory}persisted.txt`, 'stored');
    expect([...storage.map.keys()]).toContain('rn-file-system:f:/native-surface/cache/persisted.txt');
    expect(await readAsStringAsync(`${cacheDirectory}persisted.txt`)).toBe('stored');

    await deleteAsync(`${cacheDirectory}persisted.txt`);
    expect([...storage.map.keys()]).toHaveLength(0);
  });

  test('a quota failure surfaces as a clear coded error and leaves the file untouched', async () => {
    const storage = makeStorage(400);
    vi.stubGlobal('localStorage', storage);
    await writeAsStringAsync(`${cacheDirectory}small.txt`, 'keep me');

    const tooBig = 'x'.repeat(1000);
    const failure = await writeAsStringAsync(`${cacheDirectory}small.txt`, tooBig).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/localStorage quota/);
    expect((failure as Error).message).toMatch(/base64/);
    expect((failure as { code?: string }).code).toBe('ERR_FILESYSTEM_QUOTA');

    // Nothing was truncated: the previous contents survive.
    expect(await readAsStringAsync(`${cacheDirectory}small.txt`)).toBe('keep me');
  });

  test('disk-space reporting tracks what the store actually holds', async () => {
    expect(await getTotalDiskCapacityAsync()).toBe(5 * 1024 * 1024);
    const before = await getFreeDiskStorageAsync();
    await writeAsStringAsync(`${cacheDirectory}big.txt`, 'y'.repeat(1024));
    expect(await getFreeDiskStorageAsync()).toBe(before - 1024);
  });
});

describe('file-system compat shim: transfers', () => {
  test('downloadAsync fetches, stores the bytes, and reports progress', async () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(payload, { status: 200, headers: { 'content-type': 'image/png', 'content-length': '5' } })
      )
    );

    const progress: number[] = [];
    const result = await downloadAsync('https://example.test/pixel.png', `${cacheDirectory}pixel.png`, {
      onProgress: ({ bytesWritten }) => progress.push(bytesWritten),
    });

    expect(result).toMatchObject({ uri: `${cacheDirectory}pixel.png`, status: 200, mimeType: 'image/png' });
    expect(Array.from(new File(Paths.cache, 'pixel.png').bytesSync())).toEqual([1, 2, 3, 4, 5]);
    expect(progress.at(-1)).toBe(5);
  });

  test('downloadAsync reports a non-2xx response instead of writing a broken file', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    await expect(downloadAsync('https://example.test/x', `${cacheDirectory}x`)).rejects.toThrow(/HTTP 404/);
    expect(new File(Paths.cache, 'x').exists).toBe(false);
  });

  test('uploadAsync sends the stored bytes, binary or multipart', async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push(init);
        return new Response('ok', { status: 201 });
      })
    );
    await writeAsStringAsync(`${cacheDirectory}up.txt`, 'payload');

    const binary = await uploadAsync('https://example.test/upload', `${cacheDirectory}up.txt`, { httpMethod: 'PUT' });
    expect(binary).toMatchObject({ status: 201, body: 'ok' });
    expect(calls[0]?.method).toBe('PUT');
    expect(await (calls[0]?.body as Blob).text()).toBe('payload');

    await uploadAsync('https://example.test/upload', `${cacheDirectory}up.txt`, {
      uploadType: FileSystemUploadType.MULTIPART,
      fieldName: 'file',
      parameters: { kind: 'test' },
    });
    const form = calls[1]?.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get('kind')).toBe('test');
  });

  test('copyAsync ingests a fetchable source so it becomes a real file uri', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([9, 8, 7]), { status: 200 })));
    await copyAsync({ from: 'blob:http://localhost/opaque', to: `${cacheDirectory}ingested.bin` });
    expect(Array.from(new File(Paths.cache, 'ingested.bin').bytesSync())).toEqual([9, 8, 7]);
  });

  test('an external uri is readable asynchronously but is not an entry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('remote', { status: 200 })));
    const external = new File('https://example.test/remote.txt');
    expect(external.exists).toBe(false);
    expect(external.uri).toBe('https://example.test/remote.txt');
    expect(await external.text()).toBe('remote');
    expect(() => external.textSync()).toThrow(/not an entry in this virtual filesystem/);
    expect(() => external.write('x')).toThrow(/copyAsync/);
  });
});

describe('media-library compat shim', () => {
  test('every album and asset query resolves empty rather than throwing', async () => {
    expect(await MediaLibrary.getAlbumsAsync()).toEqual([]);
    expect(await MediaLibrary.getAlbumAsync('Camera')).toBeNull();
    expect(await MediaLibrary.getMomentsAsync()).toEqual([]);
    expect(await MediaLibrary.getAssetsAsync({ first: 20 })).toEqual({
      assets: [],
      endCursor: '',
      hasNextPage: false,
      totalCount: 0,
    });
    expect(await MediaLibrary.Album.getAll()).toEqual([]);
    expect(await MediaLibrary.Album.get('Camera')).toBeNull();

    const query = new MediaLibrary.Query()
      .eq(MediaLibrary.AssetField.MEDIA_TYPE, 'image')
      .lte(MediaLibrary.AssetField.HEIGHT, 1080)
      .orderBy(MediaLibrary.AssetField.CREATION_TIME)
      .limit(20);
    expect(await query.exe()).toEqual([]);
    expect(await query.exeForMetadata()).toEqual([]);

    const info = await MediaLibrary.getAssetInfoAsync('file:///whatever.jpg');
    expect(info).toMatchObject({ id: 'file:///whatever.jpg', isFavorite: false });
  });

  test('mutating album calls report false rather than pretending they worked', async () => {
    expect(await MediaLibrary.addAssetsToAlbumAsync('a', 'b')).toBe(false);
    expect(await MediaLibrary.removeAssetsFromAlbumAsync('a', 'b')).toBe(false);
    expect(await MediaLibrary.deleteAssetsAsync('a')).toBe(false);
    expect(await MediaLibrary.deleteAlbumsAsync('a')).toBe(false);
    expect(await MediaLibrary.setAssetFavoriteAsync('a', true)).toBe(false);
    expect(await MediaLibrary.albumNeedsMigrationAsync('a')).toBe(false);
  });

  test('permissions are granted and the save path reports available', async () => {
    expect(await MediaLibrary.isAvailableAsync()).toBe(true);
    expect(await MediaLibrary.requestPermissionsAsync(false, ['photo'])).toMatchObject({
      status: 'granted',
      granted: true,
      accessPrivileges: 'all',
    });
    expect((await MediaLibrary.getPermissionsAsync(true)).granted).toBe(true);
  });

  test('MediaType exports both surfaces vocabularies under one name', () => {
    expect(MediaLibrary.MediaType.photo).toBe('photo');
    expect(MediaLibrary.MediaType.IMAGE).toBe('image');
    expect(MediaLibrary.MediaType.video).toBe('video');
    expect(MediaLibrary.MediaType.VIDEO).toBe('video');
    expect(MediaLibrary.SortBy.creationTime).toBe('creationTime');
  });

  test('listeners subscribe and unsubscribe cleanly even though nothing ever fires', () => {
    const subscription = MediaLibrary.addListener(() => {});
    expect(typeof subscription.remove).toBe('function');
    MediaLibrary.removeSubscription(subscription);
    MediaLibrary.removeAllListeners();
  });
});

describe('image-manipulator compat shim: argument contract', () => {
  test('malformed actions throw the documented TypeErrors', async () => {
    await expect(manipulateAsync('file:///a.png', [{ rotate: 'ninety' } as never])).rejects.toThrow(
      /Rotation must be a number/
    );
    await expect(manipulateAsync('file:///a.png', [{ resize: {}, rotate: 1 } as never])).rejects.toThrow(
      /exactly one transformation/
    );
    await expect(manipulateAsync('file:///a.png', [{ blur: 2 } as never])).rejects.toThrow(/Unsupported action type: blur/);
    await expect(manipulateAsync('file:///a.png', [{ flip: 'sideways' } as never])).rejects.toThrow(
      /Unsupported flip type/
    );
    await expect(manipulateAsync('file:///a.png', [], { compress: 2 })).rejects.toThrow(/between 0 and 1/);
    await expect(manipulateAsync('file:///a.png', [], { format: 'tiff' as never })).rejects.toThrow(
      /must be one of: jpeg, png, webp/
    );
  });

  test('a realm with no image decoder fails loudly instead of hanging', async () => {
    // Node has fetch but neither createImageBitmap nor Image, so the shim must
    // say which capability is missing rather than resolve something empty.
    await expect(manipulateAsync('data:image/png;base64,AAAA', [], { format: SaveFormat.PNG })).rejects.toThrow(
      /createImageBitmap nor Image/
    );
  });
});
