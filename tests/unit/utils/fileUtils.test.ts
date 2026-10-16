import {
    isTemporaryFile,
    isBinaryFile,
    arrayBufferToString,
    toArrayBuffer,
    validateFileName,
} from '@src/utils/fileUtils';

describe('File Utils', () => {
    it.each(['bad\u0000name', 'bad\u001fname', 'bad\tname', 'bad\nname'])('retains the existing ASCII-control filename rejection', name => {
        expect(validateFileName(name).valid).toBe(false);
    });
    describe('isBinaryFile', () => {
        it('keeps Quiver TikZ-CD sources editable as text', () => {
            expect(isBinaryFile('/assets/quiver/diagram.tikzcd')).toBe(false);
            expect(isBinaryFile('/assets/quiver/diagram.pending.tikzcd')).toBe(false);
            expect(isBinaryFile('/assets/quiver/diagram.svg')).toBe(true);
        });
    });

    describe('isTemporaryFile', () => {
        it.each(['/.gitea/ISSUE_TEMPLATE/config.yml', '/.gitea/ISSUE_TEMPLATE/erratum.yml', '/.github/workflows/check.yml', '/.gitignore', '/.gitattributes', '/.gitmodules'])('keeps tracked Git-adjacent path %s visible', path => {
            expect(isTemporaryFile(path)).toBe(false);
        });

        it.each(['/.git', '/.git/config', '/.git/objects/ab/cd', '/.git/refs/heads/main'])('keeps actual Git metadata %s private', path => {
            expect(isTemporaryFile(path)).toBe(true);
        });

        it('should identify temporary files', () => {
            expect(isTemporaryFile('/.texlyre-cache/file.aux')).toBe(true);
            expect(isTemporaryFile('/.texlyre-temp/build/output.pdf')).toBe(true);
        });

        it('should reject non-temporary files', () => {
            expect(isTemporaryFile('/main.tex')).toBe(false);
            expect(isTemporaryFile('/chapters/intro.tex')).toBe(false);
            expect(isTemporaryFile('/images/figure.png')).toBe(false);
        });

        it('should handle edge cases', () => {
            expect(isTemporaryFile('')).toBe(false);
            expect(isTemporaryFile('/')).toBe(false);
            expect(isTemporaryFile('.texlyre-cache')).toBe(false);
        });
    });

    describe('arrayBufferToString', () => {
        it('should convert ArrayBuffer to string', () => {
            const text = 'Hello, World!';
            const buffer = new TextEncoder().encode(text).buffer;

            const result = arrayBufferToString(buffer);

            expect(result).toBe(text);
        });

        it('should handle UTF-8 characters', () => {
            const text = 'Hello 世界 🌍';
            const buffer = new TextEncoder().encode(text).buffer;

            const result = arrayBufferToString(buffer);

            expect(result).toBe(text);
        });

        it('should handle empty buffer', () => {
            const buffer = new ArrayBuffer(0);

            const result = arrayBufferToString(buffer);

            expect(result).toBe('');
        });
    });

    describe('toArrayBuffer', () => {
        it('should convert Uint8Array to ArrayBuffer', () => {
            const data = new Uint8Array([72, 101, 108, 108, 111]);

            const result = toArrayBuffer(data);

            expect(result).toBeInstanceOf(ArrayBuffer);
            expect(new Uint8Array(result)).toEqual(data);
        });

        it('should preserve data integrity', () => {
            const original = 'Test data 123';
            const uint8 = new TextEncoder().encode(original);

            const buffer = toArrayBuffer(uint8);
            const decoded = new TextDecoder().decode(buffer);

            expect(decoded).toBe(original);
        });
    });
});
