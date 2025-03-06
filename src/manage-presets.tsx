import { Action, ActionPanel, confirmAlert, Form, List, showToast, Toast } from "@raycast/api";
import { useEffect, useState } from "react";
import { addPreset, deletePreset, editPreset, listPresets } from "./rewrite-this";

interface Preset {
  id: string;
  name: string;
  prompt: string;
}

enum View {
  LIST,
  ADD,
  EDIT,
}

export default function ManagePresetsCommand() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentView, setCurrentView] = useState<View>(View.LIST);
  const [selectedPreset, setSelectedPreset] = useState<Preset | null>(null);

  async function fetchPresets() {
    try {
      setIsLoading(true);
      const allPresets = await listPresets();
      setPresets(allPresets);
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to Load Presets",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchPresets();
  }, []);

  async function handleDelete(preset: Preset) {
    const confirmed = await confirmAlert({
      title: "Delete Preset",
      message: `Are you sure you want to delete "${preset.name}"?`,
      primaryAction: {
        title: "Delete",
      },
    });

    if (!confirmed) return;

    try {
      await deletePreset(preset.id);

      await showToast({
        style: Toast.Style.Success,
        title: "Preset Deleted",
        message: `"${preset.name}" has been deleted`,
      });

      // Refresh the list
      await fetchPresets();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to Delete Preset",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  async function handleDuplicate(preset: Preset) {
    try {
      // Create a new preset with the same name and prompt but a new ID
      await addPreset(`${preset.name} (Copy)`, preset.prompt);

      await showToast({
        style: Toast.Style.Success,
        title: "Preset Duplicated",
        message: `Created a copy of "${preset.name}"`,
      });

      // Refresh the list
      await fetchPresets();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to Duplicate Preset",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // Render different views based on the current state
  if (currentView === View.ADD) {
    return (
      <AddPresetForm
        onCancel={() => setCurrentView(View.LIST)}
        onSuccess={() => {
          setCurrentView(View.LIST);
          fetchPresets();
        }}
      />
    );
  }

  if (currentView === View.EDIT && selectedPreset) {
    return (
      <EditPresetForm
        preset={selectedPreset}
        onCancel={() => {
          setCurrentView(View.LIST);
          setSelectedPreset(null);
        }}
        onSuccess={() => {
          setCurrentView(View.LIST);
          setSelectedPreset(null);
          fetchPresets();
        }}
      />
    );
  }

  // Default view: List of presets
  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search presets...">
      <List.Section title="Actions">
        <List.Item
          title="Add New Preset"
          icon="✨"
          actions={
            <ActionPanel>
              <Action title="Add Preset" onAction={() => setCurrentView(View.ADD)} />
            </ActionPanel>
          }
        />
      </List.Section>

      <List.Section title="All Presets">
        {presets.map((preset) => (
          <List.Item
            key={preset.id}
            title={preset.name}
            subtitle={preset.prompt.length > 50 ? `${preset.prompt.substring(0, 50)}...` : preset.prompt}
            accessories={[{ text: preset.id.startsWith("user_") ? "Custom" : "Default" }]}
            actions={
              <ActionPanel>
                <Action
                  title="Edit Preset"
                  onAction={() => {
                    setSelectedPreset(preset);
                    setCurrentView(View.EDIT);
                  }}
                />
                <Action title="Delete Preset" onAction={() => handleDelete(preset)} />
                <Action title="Duplicate Preset" onAction={() => handleDuplicate(preset)} />
                <Action.CopyToClipboard title="Copy Prompt" content={preset.prompt} />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  );
}

// Form for adding a new preset
function AddPresetForm({ onCancel, onSuccess }: { onCancel: () => void; onSuccess: () => void }) {
  const [nameError, setNameError] = useState<string | undefined>();
  const [promptError, setPromptError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(values: { name: string; prompt: string }) {
    if (!values.name) {
      setNameError("Name is required");
      return;
    }

    if (!values.prompt) {
      setPromptError("Prompt is required");
      return;
    }

    setIsSubmitting(true);

    try {
      await addPreset(values.name, values.prompt);

      await showToast({
        style: Toast.Style.Success,
        title: "Preset Added",
        message: `"${values.name}" has been added to your presets`,
      });

      onSuccess();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to Add Preset",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Add Preset" onSubmit={handleSubmit} />
          <Action title="Cancel" onAction={onCancel} />
        </ActionPanel>
      }
      isLoading={isSubmitting}
    >
      <Form.TextField
        id="name"
        title="Name"
        placeholder="e.g., Professional Email"
        error={nameError}
        onChange={() => setNameError(undefined)}
      />
      <Form.TextArea
        id="prompt"
        title="Prompt"
        placeholder="e.g., Rewrite this text in a professional tone suitable for business emails."
        error={promptError}
        onChange={() => setPromptError(undefined)}
      />
    </Form>
  );
}

// Form for editing an existing preset
function EditPresetForm({
  preset,
  onCancel,
  onSuccess,
}: {
  preset: Preset;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [nameError, setNameError] = useState<string | undefined>();
  const [promptError, setPromptError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(values: { name: string; prompt: string }) {
    if (!values.name) {
      setNameError("Name is required");
      return;
    }

    if (!values.prompt) {
      setPromptError("Prompt is required");
      return;
    }

    setIsSubmitting(true);

    try {
      await editPreset(preset.id, values.name, values.prompt);

      await showToast({
        style: Toast.Style.Success,
        title: "Preset Updated",
        message: `"${values.name}" has been updated`,
      });

      onSuccess();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to Update Preset",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Update Preset" onSubmit={handleSubmit} />
          <Action title="Cancel" onAction={onCancel} />
        </ActionPanel>
      }
      isLoading={isSubmitting}
    >
      <Form.TextField
        id="name"
        title="Name"
        defaultValue={preset.name}
        error={nameError}
        onChange={() => setNameError(undefined)}
      />
      <Form.TextArea
        id="prompt"
        title="Prompt"
        defaultValue={preset.prompt}
        error={promptError}
        onChange={() => setPromptError(undefined)}
      />
    </Form>
  );
}
