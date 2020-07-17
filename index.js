/* Create your personal token on https://lichess.org/account/oauth/token */
const LICHESS_TOKEN = process.env.LICHESS_TOKEN; 

const axios = require('axios')
const fs = require("fs")
const path = require("path")
const { inspect } = require("util")

const TOURNAMENT_RE = /href="\/tournament\/([^\"]+)">/;

const CACHE_DIR = path.join(__dirname, "cache")

const uniq = arr => Object.keys(arr.reduce((memo, item) => {memo[item] = true; return memo}, {}))

const present = arr => arr.filter(item => !!item)

const cachePath = filePath => path.join(CACHE_DIR, filePath)

const cacheExists = filePath => fs.existsSync(cachePath(filePath))

const loadFromCache = filePath => fs.readFileSync(cachePath(filePath))

const saveInCache = (filePath, data) => {
  return new Promise((res, rej) => {
    fs.mkdir(path.dirname(cachePath(filePath)), {recursive: true}, (err) => {
      if (err) rej(err)
      fs.writeFileSync(cachePath(filePath), data)
      res()
    })
  })
}

const cachedRequest = async (path, requestFunction) => {
  if (!cacheExists(path)) {
    // assuming request will be ok always
    const { data } = await requestFunction()
    await saveInCache(path, JSON.stringify(data))
  }

  return JSON.parse(loadFromCache(path))
}



const AXMA = {
  points: [10, 8, 6, 3, 2],
  medals: ["🥇", "🥈", "🥉"],
  userMaps: {
    'Allan33a': 'allan_AS',
    'Drelielson': 'Drelielson_AS',
    'EduHnrq_AS': 'eduardohenrique_AS',
    'eyshi': 'Eyshi_AS',
    'Jfilho_torn': 'Jfilho_AS',
    'LucasMax': 'LucasMax_AS',
    'manoelquirinoneto': 'manoelquirinoneto_AS',
    'Mr-Jonas009': 'Jonas07_AS',
    'Nkbdohaojsdk': 'CarlosHenrique_AS',
    'Ton_aprendiz': 'Tonsall_AS',
    'Tonsall': 'Tonsall_AS',
    'VegetaSama13': 'VegetaSama_AS',
    'vicc70': 'ViicAS',
    'Vick7': 'ViicAS',
    'xoxocould': 'Jfilho_AS',
    'andrehenrique_AS': 'andrehenriq_AS',
    'fernandomarx': 'Fernandomarx_AS',
  },
  excludeTournaments: ['J2EGtXiN', 'oBRtdCrN', 'sGMpNkje', 'fLK31eke'],
  allowedTournamentCreators: [
    'jfilho_as',
    'lucasmax_as',
    'eduhnrq_as',
    'lucasmax',
    'eduardohenrique_as'
  ],
  usersToFetch: [
    "EduHnrq_AS",
    "Jfilho_AS",
    "eduardohenrique_AS",
  ],
  excludeUsers: ['Seifador_de_Manoel', 'marshmall0ew', 'Nielison_AS', 'Pedro_AS'],
  getPoints: index => index >= AXMA.points.length ? 1 : AXMA.points[index],
  normalizeUser: user => AXMA.userMaps[user] ? AXMA.userMaps[user] : user,
  removeTournaments: tournamentIds => tournamentIds.filter(id => !AXMA.excludeTournaments.includes(id)),
  removeUsers: userIds => userIds.filter(id => !AXMA.excludeUsers.includes(id))
}

const recursive = async (objects, fetchFunction) => {
  const remainingObjs = [...objects]
  const obj = remainingObjs.shift()
  if (!obj) return []

  const result = await fetchFunction(obj)

  return [result].concat(await recursive(remainingObjs, fetchFunction))
}

const getUserGameIds = async (userId) => {
  const gamePgns = await cachedRequest(`user_games/${userId}.txt`, () => {
    console.log(`fetching games from ${userId}`)

    return axios.get(
      `/api/games/user/${userId}?moves=false`,
      {
        baseURL: 'https://lichess.org/',
        headers: { 'Authorization': 'Bearer ' + LICHESS_TOKEN }
      }
    )
  })

  const events = []
  let event;

  gamePgns.split("\n").forEach(line => {
    if (line.startsWith("[Event")) {
      event = {}
      events.push(event)
    } else if (line.startsWith("[Date")) {
      event.date = line.replace("[Date \"", "").replace("\"]", "")
    } else if (line.startsWith("[Site")) {
      event.gameId = line.replace("[Site \"https://lichess.org/", "").replace("\"]", "")
    }
  })

  return Object.values(
    events.reduce((memo, event) => { return ({...memo, [event.date]: event.gameId})}, {})
  )
}

const fetchGames = userIds => recursive(userIds, userId => getUserGameIds(userId))

const getTournamentIds = gameIds => recursive(gameIds, async (gameId) => {
  const data = await cachedRequest(`games/${gameId}`, () => {
    console.log(`Fetching game ${gameId}`)
    return axios.get(`https://lichess.org/${gameId}`)
  })
  const matchData = TOURNAMENT_RE.exec(data)

  return matchData ? matchData[1] : null
})

const parseTournamentResult = (id, rawTournament) => {
  const playersInfo = rawTournament
          .trim()
          .split("\n")
          .map(d => JSON.parse(d))
          .map(({username, rank, performance}) => ({
            username,
            performance,
            rank,
            points: AXMA.getPoints(rank - 1)
          }))


  return {
    id, 
    playersInfo
  }
}

const getTournamentsResults = tournamentIds => recursive(tournamentIds, async (tournamentId) => {
  
  const rawTournament = await cachedRequest(`tournaments_results/${tournamentId}.json`, async () => {
    console.log(`Fetching tournament results ${tournamentId}`)

    return await axios.get(
      `/api/tournament/${tournamentId}/results`,
      {
        baseURL: 'https://lichess.org/',
        headers: { 'Authorization': 'Bearer ' + LICHESS_TOKEN }
      }
    )
  })

  return parseTournamentResult(tournamentId, rawTournament)
})

const transformTournamentResults = tournamentResults =>
  tournamentResults.reduce((memo, tournament) => {
    memo[tournament.id] = tournament.playersInfo.reduce((memo, playerInfo) => {
      memo[AXMA.normalizeUser(playerInfo.username)] = playerInfo
      return memo
    }, {})
    return memo
  }, {})

const allUsersFromTournament = tournamentData => 
  uniq(Object.values(tournamentData).flatMap(tournament => Object.keys(tournament)))

const fetchTournaments = tournamentIds => recursive(tournamentIds, tournamentId => cachedRequest(`tournaments/${tournamentId}.json`, () => {
  console.log(`Fetching tournament ${tournamentId}`)

  return axios.get(
    `/api/tournament/${tournamentId}`,
    {
      baseURL: 'https://lichess.org/',
      headers: { 'Authorization': 'Bearer ' + LICHESS_TOKEN }
    }
  )
}))

const app = async () => {

  const gameIds = uniq((await fetchGames(AXMA.usersToFetch)).flat());
  let tournamentIds = uniq(present(await getTournamentIds(gameIds)))
  tournamentIds = AXMA.removeTournaments(tournamentIds);
  tournamentIds = (await fetchTournaments(tournamentIds)).sort(
    (t1, t2) => new Date(t1.startsAt) - new Date(t2.startsAt)
  ).filter(t => AXMA.allowedTournamentCreators.includes(t.createdBy.toLowerCase())).map(t => t.id)

  console.log(
    (await fetchTournaments(tournamentIds)).map(t => `https://lichess.org/tournament/${t.id} - ${t.fullName}`).join("\n")
  )
  
  let tournamentResults = await getTournamentsResults(tournamentIds)
  const tournamentData = transformTournamentResults(tournamentResults)

  const allUsers = (AXMA.removeUsers(allUsersFromTournament(tournamentData))).sort((u1, u2) =>
    u1.toLowerCase().localeCompare(u2.toLowerCase())
  )


  // print tournament headers
  console.log(["Membros"].concat(tournamentIds.map((id, idx) => `Torneio ${idx + 1}`)).join(","))

  // print players performance
  console.log(
    allUsers.map(user => 
      [user].concat(
        tournamentIds.map(tournamentId =>
          tournamentData[tournamentId][user] ? tournamentData[tournamentId][user].performance : '-'
        )
      ).join(",")
    ).join("\n")
  )

  // print players points and medals headers
  console.log(["Membros", "Pontuação", "Medalhas"].join(","))

  // print players points and medals
  console.log(
    allUsers.map(user => {

      const points = tournamentIds.reduce((sum, id) => {
        if (tournamentData[id][user]) {
          return sum + tournamentData[id][user].points
        } else {
          return sum
        }
      },0)

      let medals = tournamentIds.reduce((memo, id) => {
        if (tournamentData[id][user]) {
          const { rank } = tournamentData[id][user]
          const medal = AXMA.medals[rank - 1]

          if (medal) {
            if (!memo[medal]) memo[medal] = 0
            memo[medal] += 1
          }
        }

        return memo
      }, {})

      if (medals === {}) {
        medals = '-'
      } else {
        medals = AXMA.medals
          .filter(m => medals[m])
          .map(m => medals[m] == 1 ? m : `${m}(${medals[m]}x)`)
          .join(' ')
      }

      return [user, points, medals].join(',')
    }).join("\n")
  )
}

app()