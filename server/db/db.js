const { Pool } = require("pg");
const format = require("pg-format");

const pool = new Pool();

module.exports = {
    query: (text, params) => {
        let query = format.withArray(text, params);
        console.log(query);
        return pool.query(query);
    }
};