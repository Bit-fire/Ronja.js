// Discord-specific dependencies
const { Ronja } = require('./ronja_modules/Ronja.js');
const { Intents, MessageEmbed } = require('discord.js');

// Cron-module
const cron = require('node-cron');

// Load Ronja's modular system
const ronja_modules = [];

ronja_modules.push(require('./ronja_modules/AmazonGamesServerStatus.js'));
ronja_modules.push(require('./ronja_modules/Zocken.js'));
ronja_modules.push(require('./ronja_modules/Top10.js'));
ronja_modules.push(require('./ronja_modules/Serverprofil.js'));

// Timezone TODO: move to config
const myTimezone = 'Europe/Berlin';

// TODO: move to config
const cMinimumPlayers = 3;


const client = new Ronja({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_VOICE_STATES, Intents.FLAGS.GUILD_PRESENCES]});


client.once('ready', () => {

	client.myReady();

	ronja_modules.forEach(m => {
		if (m.init) m.init(client);
	});

	ronja_modules.forEach(m => {
		if (m.hookForCron) {
			m.hookForCron().forEach(mc => {
				if (!cron.validate(mc.schedule)) console.error(`ERROR: ${mc.schedule} is not a valid cron pattern.`);
				cron.schedule(mc.schedule, mc.action, {timezone: myTimezone});
			});
		};
	});

	console.log('Ready!');
});

client.on('interactionCreate', async interaction => {
	if (!interaction.isCommand() && !interaction.isContextMenu() && !interaction.isButton()) return;
	console.log(`${interaction.member.displayName} nutzt den Befehl ${interaction.commandName}.`)

	ronja_modules.forEach(m => {
		if (m.hookForInteraction) m.hookForInteraction(interaction);
	});
});

client.on('voiceStateUpdate', async (oldState, newState) => {
   if (newState.channel && newState.channel.userLimit === 1) {
		let newChannel = await newState.channel.parent.createChannel(`Kanal von ${newState.member.displayName}`,{type: 'GUILD_VOICE', bitrate: 128000});
		newChannel.lockPermissions();
		await newState.setChannel(newChannel);
   } 

   if (oldState.channel && oldState.channel != newState.channel && oldState.channel.isVoice() && oldState.channel.userLimit === 0 && oldState.channel.members.size === 0) {
	   await oldState.channel.delete();
   }

   if (oldState.channel && oldState.channel != newState.channel && oldState.channel.userLimit === 0 && oldState.channel.members.size > 0) await client.mySetGameAsChannelName(oldState.channel);
   if (newState.channel && oldState.channel != newState.channel && newState.channel.userLimit === 0 && newState.channel.members.size > 0) await client.mySetGameAsChannelName(newState.channel);
});

client.on('presenceUpdate', (oldPresence, newPresence) => {
	if (newPresence.member.user.bot) return;

	newPresence.activities.forEach(async newActivity => {
		if (newActivity.type === 'PLAYING') {
			let justStarted = true;
			oldPresence?.activities.forEach(oldActivity => {
				if (oldActivity.name === newActivity.name) justStarted = false;
			});

			if (justStarted) {
				console.log(`${newPresence.member.displayName} spielt ${newActivity.name}.`);
				let [game,gameCreated] = await client.myDB.Games.findOrCreate({
					where: {name: newActivity.name},
				});
				
				let [gamePlayed,gamePlayedCreated] = await client.myDB.GamesPlayed.findOrCreate({
					where: {GameId: game.id, member: newPresence.member.id},
					defaults: {lastplayed: newActivity.createdTimestamp},
				});
				if (gamePlayedCreated == false) {
					await gamePlayed.update({lastplayed: newActivity.createdTimestamp});
				};
				
				if (gameCreated == false) {
					if (game.channel) {
						let gameChannel = await client.channels.fetch(game.channel);
						gameChannel.permissionOverwrites.create(newPresence.member.user,{'VIEW_CHANNEL': true});
					} else {
						let players  = await client.myDB.GamesPlayed.findAndCountAll({
							where: {GameId: game.id},
						});

						if (players.count >= cMinimumPlayers) {
							let autoChannel = await client.channels.fetch(client.myConfig.AktiveSpieleKategorie)
							let newChannel = await autoChannel.createChannel(newActivity.name,{
								type: 'GUILD_TEXT',
								permissionOverwrites: [
									{
										id: newPresence.guild.roles.everyone,
										deny: ['VIEW_CHANNEL'],
									},
									{
										id: newPresence.guild.me,
										allow: ['VIEW_CHANNEL'],
									},
								],										
							});
							players.rows.forEach(async player => {
								let player_member = await newPresence.guild.members.fetch(player.member);
								newChannel.permissionOverwrites.create(player_member,{'VIEW_CHANNEL': true});
							});
							game.update({channel: newChannel.id});
						};
					};
				};
				if (newPresence.member.voice.channel) await client.mySetGameAsChannelName(newPresence.member.voice.channel);
			}
		}
	});
 
});

client.login(client.myConfig.token);