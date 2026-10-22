import { useState } from 'react';
import { Modal } from '@/components/common/Modal';
import { ConnectionsPanel } from '../ConnectionsPanel';

interface ConnectionsDialogProps {
  open: boolean;
  onClose: () => void;
}

/** Database connections, managed in a dialog over the semantic model page
 * rather than on a page of their own. */
export function ConnectionsDialog({ open, onClose }: ConnectionsDialogProps) {
  // While the add/edit form is open on top, Escape/backdrop must only close
  // that form - not this dialog underneath it.
  const [editorOpen, setEditorOpen] = useState(false);

  return (
    <Modal open={open} onClose={onClose} title="Database connections" width={1040} dismissable={!editorOpen}>
      <ConnectionsPanel embedded onEditorOpenChange={setEditorOpen} />
    </Modal>
  );
}
