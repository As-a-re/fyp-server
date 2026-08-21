const supabase = require("../config/database");

/**
 * Database utility module
 * Provides an interface for executing database queries
 */

const db = {
  /**
   * Execute a query against the database
   * @param {string} query - SQL query with ? placeholders
   * @param {Array} values - Query parameters
   * @returns {Promise<Array>} Query results
   */
  async execute(query, values = []) {
    try {
      // Convert parameterized query to Supabase format
      // This is a simplified implementation that handles basic SQL operations

      // For INSERT operations
      if (query.trim().toUpperCase().startsWith("INSERT")) {
        const match = query.match(/INSERT INTO (\w+)\s*\((.*?)\)\s*VALUES/i);
        if (match) {
          const table = match[1];
          const columns = match[2].split(",").map((c) => c.trim());

          const { data, error } = await supabase
            .from(table)
            .insert([
              columns.reduce((obj, col, index) => {
                obj[col] = values[index];
                return obj;
              }, {}),
            ])
            .select();

          if (error) throw error;
          return data || [];
        }
      }

      // For UPDATE operations
      if (query.trim().toUpperCase().startsWith("UPDATE")) {
        const tableMatch = query.match(/UPDATE\s+(\w+)/i);
        const setMatch = query.match(/SET\s+(.*?)\s+WHERE/i);
        const whereMatch = query.match(/WHERE\s+(.*?)$/i);

        if (tableMatch && whereMatch) {
          const table = tableMatch[1];
          const updateObj = {};
          const whereObj = {};
          let paramIndex = 0;

          // Parse SET clause
          if (setMatch) {
            const setPairs = setMatch[1].split(",").map((s) => s.trim());
            setPairs.forEach((pair) => {
              const [col] = pair.split("=").map((s) => s.trim());
              if (!col.includes("NOW()") && !col.includes("=")) {
                updateObj[col] = values[paramIndex++];
              }
            });
          }

          // Parse WHERE clause
          const whereParts = whereMatch[1].split("AND").map((s) => s.trim());
          whereParts.forEach((part) => {
            const [col] = part.split("=").map((s) => s.trim());
            whereObj[col] = values[paramIndex++];
          });

          const { data, error } = await supabase
            .from(table)
            .update(updateObj)
            .match(whereObj)
            .select();

          if (error) throw error;
          return data || [];
        }
      }

      // For SELECT operations
      if (query.trim().toUpperCase().startsWith("SELECT")) {
        const match = query.match(/FROM\s+(\w+)/i);
        if (match) {
          const table = match[1];
          const { data, error } = await supabase.from(table).select();

          if (error) throw error;
          return data || [];
        }
      }

      throw new Error(`Unsupported query type: ${query.substring(0, 50)}`);
    } catch (error) {
      console.error("Database error:", error);
      throw error;
    }
  },

  /**
   * Get Supabase client directly for advanced operations
   */
  getClient() {
    return supabase;
  },
};

module.exports = db;
