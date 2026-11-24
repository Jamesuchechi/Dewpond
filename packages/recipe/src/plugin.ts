export interface StepPluginContext {
  sourceAlias: string;
  targetAlias: string;
  params: Record<string, unknown>;
}

export interface StepPluginDefinition {
  id: string;
  label: string;
  description: string;
  compileSql: (ctx: StepPluginContext) => string;
}

export interface StepPluginRegistry {
  register: (plugin: StepPluginDefinition) => void;
  get: (id: string) => StepPluginDefinition | undefined;
  list: () => StepPluginDefinition[];
  compile: (id: string, ctx: StepPluginContext) => string;
}

/**
 * Create a public step-plugin registry for custom deterministic SQL step extensions.
 */
export function createStepPluginRegistry(): StepPluginRegistry {
  const plugins = new Map<string, StepPluginDefinition>();

  return {
    register(plugin) {
      const id = plugin.id.trim();
      if (!/^[a-z][a-z0-9_-]{1,47}$/.test(id)) {
        throw new Error(
          `Invalid step plugin id "${plugin.id}". Use lowercase alphanumeric, "_" or "-" (2-48 chars).`,
        );
      }
      if (plugins.has(id)) {
        throw new Error(`Step plugin "${id}" is already registered.`);
      }
      plugins.set(id, { ...plugin, id });
    },
    get(id) {
      return plugins.get(id);
    },
    list() {
      return [...plugins.values()];
    },
    compile(id, ctx) {
      const plugin = plugins.get(id);
      if (!plugin) {
        throw new Error(`Unknown step plugin "${id}".`);
      }
      const sql = plugin.compileSql(ctx).trim();
      if (!sql) {
        throw new Error(`Step plugin "${id}" returned empty SQL.`);
      }
      return sql.endsWith(';') ? sql : `${sql};`;
    },
  };
}
