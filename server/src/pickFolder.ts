import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';
import { HttpError } from './workspaceFs.js';

const execFileAsync = promisify(execFile);

// Generous timeout: the process is the open dialog, and the user may take
// a while to navigate. On timeout the dialog is killed and we report cancel.
const DIALOG_TIMEOUT_MS = 5 * 60_000;

type PickKind = 'folder' | 'file';

interface ExecError extends Error {
  code?: number | string;
  stderr?: string;
  killed?: boolean;
}

function asExecError(err: unknown): ExecError {
  return err instanceof Error ? (err as ExecError) : new Error(String(err));
}

async function pickMac(kind: PickKind, title: string): Promise<string | null> {
  const chooser = kind === 'folder' ? 'choose folder' : 'choose file';
  try {
    const { stdout } = await execFileAsync(
      'osascript',
      [
        '-e',
        'tell application "System Events" to activate',
        '-e',
        `POSIX path of (${chooser} with prompt ${JSON.stringify(title)})`,
      ],
      { timeout: DIALOG_TIMEOUT_MS }
    );
    return stdout.trim() || null;
  } catch (err) {
    const e = asExecError(err);
    // Exit code 1 with "User canceled. (-128)" on stderr means cancel.
    if (e.killed || /canceled|-128/i.test(e.stderr ?? '')) return null;
    throw err;
  }
}

async function pickWindows(
  kind: PickKind,
  title: string
): Promise<string | null> {
  const psTitle = `'${title.replace(/'/g, "''")}'`;
  const script =
    kind === 'folder'
      ? [
          'Add-Type -AssemblyName System.Windows.Forms | Out-Null',
          '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
          `$d.Description = ${psTitle}`,
          '$d.ShowNewFolderButton = $true',
          'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }',
        ].join('; ')
      : [
          'Add-Type -AssemblyName System.Windows.Forms | Out-Null',
          '$d = New-Object System.Windows.Forms.OpenFileDialog',
          `$d.Title = ${psTitle}`,
          'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.FileName }',
        ].join('; ');
  try {
    const { stdout } = await execFileAsync(
      'powershell',
      ['-NoProfile', '-STA', '-Command', script],
      { timeout: DIALOG_TIMEOUT_MS }
    );
    return stdout.trim() || null;
  } catch (err) {
    if (asExecError(err).killed) return null;
    throw err;
  }
}

async function pickLinux(
  kind: PickKind,
  title: string
): Promise<string | null> {
  const zenityArgs =
    kind === 'folder'
      ? ['--file-selection', '--directory', '--title', title]
      : ['--file-selection', '--title', title];
  try {
    const { stdout } = await execFileAsync('zenity', zenityArgs, {
      timeout: DIALOG_TIMEOUT_MS,
    });
    return stdout.trim() || null;
  } catch (err) {
    const e = asExecError(err);
    if (e.code === 1 || e.killed) return null; // dialog canceled
    if (e.code !== 'ENOENT') throw err;
  }
  const kdialogArgs =
    kind === 'folder'
      ? ['--getexistingdirectory', os.homedir(), '--title', title]
      : ['--getopenfilename', os.homedir(), '--title', title];
  try {
    const { stdout } = await execFileAsync('kdialog', kdialogArgs, {
      timeout: DIALOG_TIMEOUT_MS,
    });
    return stdout.trim() || null;
  } catch (err) {
    const e = asExecError(err);
    if (e.code === 1 || e.killed) return null;
    if (e.code === 'ENOENT') {
      throw new HttpError(
        501,
        'No file picker found. Install "zenity" or "kdialog", or type the path manually.'
      );
    }
    throw err;
  }
}

async function pickPath(kind: PickKind, title: string): Promise<string | null> {
  try {
    switch (process.platform) {
      case 'darwin':
        return await pickMac(kind, title);
      case 'win32':
        return await pickWindows(kind, title);
      default:
        return await pickLinux(kind, title);
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const detail = err instanceof Error ? err.message : String(err);
    throw new HttpError(
      500,
      `Could not open the system picker (${detail}). You can type the path manually.`
    );
  }
}

export const pickFolder = (title: string) => pickPath('folder', title);
export const pickFile = (title: string) => pickPath('file', title);
