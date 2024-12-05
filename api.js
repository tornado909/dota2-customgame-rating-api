const express = require('express');

const config = require('./config.json');
const mysql = require("mysql2");

const app = express();

const serverKeys = config.keys;
const versionServer = config.version;
const admin_id = config.admin_steam_id;

// create the connection to the MySQL database
const pool = mysql.createPool({
    connectionLimit: 20,
    host: config.db_host,
    user: config.db_user,
    database: config.db_name,
    password: config.db_pass
}).promise();

async function errorHandler(message) {
	try {
		console.log(message);
	} catch (error) {
		console.error(error);
	}
}

async function checkUserProfile(steamid) {
    try {
        if (steamid) {
            const [rows] = await pool.query("SELECT COUNT(*) AS `hasPlayer` FROM `players` WHERE `steamid` = ?", [steamid]);
            const { hasPlayer } = rows[0];
        
            if (hasPlayer > 0) {
                return true;
            } else {
                
                if (steamid) {
                  await pool.query("INSERT INTO `players` (`steamid`) VALUES (?)", [steamid]);
                  return true;
                } else {
                    return false;
                }
            }
        } else {
            return false;
        }
    } catch (err) {
      errorHandler("Failed to checkUserProfile | " + err);
      return false;
    }
}

app.get('/api/v1', async (req, res) => {
    
    //console.log(req.originalUrl);    
    const { data, action, match_id, gametime, version, key } = req.query;

    if(!data || !match_id || !gametime || !version || !key){
        return res.status(400).json({ message: "Bad request: missing required parameters" });
    }
    if (version !== versionServer) {
        return res.status(400).json({ message: "Bad request: invalid version" });
    }

    let winner_id;
    let loser_id;
    let parsedData;
	let gameData;

    try {
        parsedData = await JSON.parse(data);
        if(parsedData.winner_id){
            winner_id = parsedData.winner_id;
        }
        if(parsedData.loser_id){
            loser_id = parsedData.loser_id;
        }
        if(parsedData.gameData){
            gameData = parsedData.gameData;
        }
    } catch (err) {
        errorHandler("Bad request: invalid data format | " + req.originalUrl + " | " + err);
        return res.status(400).json({ message: "Bad request: invalid data format" });
    }

    if(!admin_id.includes(winner_id) && !admin_id.includes(loser_id)){
        if (!serverKeys.includes(key)) {
            return res.status(401).json({ message: "Unauthorized" });
        }
    }

    await checkUserProfile(winner_id);
    await checkUserProfile(loser_id);

	const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
	await delay(1000)

    switch (action) {
        
        //Game End event from dota2 server
        
        case "game_end":
          let giveRating = config.give_rating;
		  let loseRating = config.lose_rating;
          
          try {
			
			if(gameData){
				await pool.query(
					"INSERT INTO `games` (`match_id`, `data`, `gametime`) VALUES (?, ?, ?)",
					[match_id, JSON.stringify(gameData), gametime]
				)
			}else{
				errorHandler("Failed to write gameData | " + error);
              	return res.status(200).json("Bad gameData: " + error.message);
			}

              const [winnerPlayerDB] = await pool.query(
                "SELECT * FROM players WHERE steamid = ? LIMIT 1",
                [winner_id]
              );
            
              if (winnerPlayerDB.length > 0) {
				const query = "UPDATE players SET rating = rating + ? WHERE steamid = ?";
				await pool.query(query, [
					giveRating,
					winner_id,
				]);
              }
			  
			  const [loserPlayerDB] = await pool.query(
                "SELECT * FROM players WHERE steamid = ? LIMIT 1",
                [loser_id]
              );
            
              if (loserPlayerDB.length > 0) {
				if(loserPlayerDB[0].rating >= 25){
					const query = "UPDATE players SET rating = rating - ? WHERE steamid = ?";
					await pool.query(query, [
						loseRating,
						loser_id,
					]);
				}
              }

              return res.status(200).json({ status: "ok" });
            } catch (error) {
              errorHandler("Failed to write gameData | " + error);
              return res.status(200).json("Database error: " + error.message);
            }

        break;

		case "get_board":
			const [leaderBoard] = await pool.query(
                "SELECT steamid, rating FROM players ORDER BY rating DESC LIMIT ?",
                [winner_id, config.leader_count]
              );

			return res.status(200).json(leaderBoard);
    
        default:
            return res.status(401).json({ message: "Bad request 3" });
    }
});

app.get('/api/check', async (req, res) => {

  try {
    const [test] = await pool.query(
		"SELECT steamid FROM players LIMIT 1"
    );
    if(test.length > 0){
      return res.status(200).json(true);
    }else{
      return res.status(200).json(false);
    }
  } catch (error) {
    errorHandler("Failed to apiCheck | " + error);
    return res.status(500).json({ message: "Internal server error", error });
  }
});

app.use((req, res) => {
    res.status(404).json({ message: 'Not found' });
});

app.listen(config.port, config.host, () => {});