use anyhow::{Context, Result, bail};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

const MAGIC: &[u8; 16] = b"ORFLOW\0RUNNER\x01\0\0";
const FOOTER_LEN: usize = 24;

pub fn split_executable(bytes: &[u8]) -> Result<(&[u8], Option<&[u8]>)> {
    if bytes.len() < FOOTER_LEN || &bytes[bytes.len() - MAGIC.len()..] != MAGIC {
        return Ok((bytes, None));
    }
    let length_pos = bytes.len() - FOOTER_LEN;
    let length = u64::from_le_bytes(bytes[length_pos..length_pos + 8].try_into().unwrap()) as usize;
    if length > length_pos {
        bail!("embedded flow trailer is corrupt");
    }
    let payload_pos = length_pos - length;
    Ok((&bytes[..payload_pos], Some(&bytes[payload_pos..length_pos])))
}

pub fn read_embedded(exe: &Path) -> Result<Option<Vec<u8>>> {
    let bytes = fs::read(exe).with_context(|| format!("cannot read {}", exe.display()))?;
    Ok(split_executable(&bytes)?.1.map(ToOwned::to_owned))
}

pub fn embed(exe: &Path, flow: &[u8]) -> Result<()> {
    let bytes = fs::read(exe).with_context(|| format!("cannot read {}", exe.display()))?;
    let (base, _) = split_executable(&bytes)?;
    let tmp = sibling(exe, "new");
    let backup = sibling(exe, "old");

    let mut output =
        fs::File::create(&tmp).with_context(|| format!("cannot create {}", tmp.display()))?;
    output.write_all(base)?;
    output.write_all(flow)?;
    output.write_all(&(flow.len() as u64).to_le_bytes())?;
    output.write_all(MAGIC)?;
    output.sync_all()?;
    drop(output);

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o755))?;
        fs::rename(&tmp, exe).context("cannot replace the runner executable")?;
    }

    #[cfg(windows)]
    {
        let _ = fs::remove_file(&backup);
        fs::rename(exe, &backup).context("cannot stage the running executable for replacement")?;
        if let Err(error) = fs::rename(&tmp, exe) {
            let _ = fs::rename(&backup, exe);
            let _ = fs::remove_file(&tmp);
            return Err(error).context("cannot replace the runner executable");
        }
    }

    Ok(())
}

pub fn cleanup_backup(exe: &Path) {
    let _ = fs::remove_file(sibling(exe, "old"));
}

fn sibling(exe: &Path, suffix: &str) -> PathBuf {
    let name = exe.file_name().unwrap_or_default().to_string_lossy();
    exe.with_file_name(format!(".{name}.{suffix}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_an_existing_payload() {
        let mut exe = b"binary".to_vec();
        exe.extend_from_slice(b"old");
        exe.extend_from_slice(&3_u64.to_le_bytes());
        exe.extend_from_slice(MAGIC);
        let (base, payload) = split_executable(&exe).unwrap();
        assert_eq!(base, b"binary");
        assert_eq!(payload, Some(b"old".as_slice()));
    }
}
