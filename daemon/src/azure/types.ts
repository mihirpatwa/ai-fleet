// Phase 18g: Azure Boards integration types.

export interface AzureConnection {
  /** e.g. https://dev.azure.com/contoso */
  org_url: string;
  /** Azure DevOps project name (the path segment after the org). */
  project: string;
  /** Last successful validation (ISO timestamp), null if never validated. */
  validated_at: string | null;
}

export interface AzureConnectionState extends AzureConnection {
  connected: boolean;
  error: string | null;
}

export type WorkItemType = 'User Story' | 'Feature' | 'Task' | 'Bug' | 'Epic' | string;

export interface WorkItemSummary {
  id: number;
  type: WorkItemType;
  title: string;
  state: string;
  assigned_to: string | null;
  iteration_path: string | null;
  changed_date: string;
  /** Web link Azure renders this work item at (so the drawer can deep-link). */
  url: string;
}

export interface WorkItemAttachment {
  name: string;
  url: string;
  size?: number;
}

export interface WorkItemRelation {
  rel: string;
  target_id?: number;
  url: string;
}

export interface WorkItemDetail extends WorkItemSummary {
  description_html: string | null;
  acceptance_criteria_html: string | null;
  repro_steps_html: string | null;
  system_history_html: string | null;
  tags: string[];
  area_path: string | null;
  priority: number | null;
  severity: string | null;
  effort: number | null;
  story_points: number | null;
  created_by: string | null;
  created_date: string | null;
  attachments: WorkItemAttachment[];
  relations: WorkItemRelation[];
}

export interface WorkItemComment {
  id: number;
  text_html: string;
  created_by: string;
  created_date: string;
  modified_date?: string;
}

export interface ListFilter {
  type?: WorkItemType[];
  state?: string[];
  assigned_to?: string;
  iteration_path?: string;
  area_path?: string;
  tag?: string;
  search?: string;
  limit?: number;
}
