// Ordered list of migrations. To add one: create 002_name.js exporting the SQL, then add it here.
import m001 from './001_schema.js';

export default [
  { name: '001_schema.sql', sql: m001 },
];
