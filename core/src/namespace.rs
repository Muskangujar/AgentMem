use sha2::{Digest, Sha256};

pub(crate) fn ns_hash(namespace: &str) -> [u8; 16] {
    let hash = Sha256::digest(namespace.as_bytes());
    let mut out = [0u8; 16];
    out.copy_from_slice(&hash[..16]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_is_deterministic() {
        assert_eq!(ns_hash("a"), ns_hash("a"));
    }

    #[test]
    fn different_namespaces_differ() {
        assert_ne!(ns_hash("a"), ns_hash("b"));
    }
}
