use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

use crate::terminal::manager::TerminalManager;

#[derive(Clone, Default)]
pub struct AgentStreamManager {
    streams: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl AgentStreamManager {
    pub fn insert(&self, stream_id: String) -> Arc<AtomicBool> {
        let cancelled = Arc::new(AtomicBool::new(false));
        self.streams
            .lock()
            .expect("agent stream state poisoned")
            .insert(stream_id, Arc::clone(&cancelled));
        cancelled
    }

    pub fn cancel(&self, stream_id: &str) -> bool {
        let cancelled = self
            .streams
            .lock()
            .expect("agent stream state poisoned")
            .remove(stream_id);
        if let Some(cancelled) = cancelled {
            cancelled.store(true, Ordering::Release);
            true
        } else {
            false
        }
    }

    pub fn remove(&self, stream_id: &str) {
        self.streams
            .lock()
            .expect("agent stream state poisoned")
            .remove(stream_id);
    }

    #[cfg(test)]
    pub fn contains(&self, stream_id: &str) -> bool {
        self.streams
            .lock()
            .expect("agent stream state poisoned")
            .contains_key(stream_id)
    }
}

#[derive(Default)]
pub struct AppState {
    pub terminals: TerminalManager,
    pub agent_streams: AgentStreamManager,
}

#[cfg(test)]
mod tests {
    use super::AgentStreamManager;
    use std::sync::atomic::Ordering;

    #[test]
    fn cancelling_stream_sets_flag_and_cleans_state() {
        let manager = AgentStreamManager::default();
        let flag = manager.insert("stream-1".to_string());
        assert!(manager.contains("stream-1"));
        assert!(manager.cancel("stream-1"));
        assert!(flag.load(Ordering::Acquire));
        assert!(!manager.contains("stream-1"));
    }
}
