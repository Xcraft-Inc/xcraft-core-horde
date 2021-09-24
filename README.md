# Xcraft Core Horde // xHorde

A module for managing hordes of Orcs and Goblins.

An horde is a server node where services are deployed. An horde can have
sub-hordes. It's a graph of servers where commands and events can be sent
between each other according to somes rules.

All nodes (servers like clients) are an horde. When a "client" connects to
a main server it's just because in its horde settings, a sub-horde is
specified. Technically the client is not a client, it's a server with the
same capabilities but with a different configuration.

There are some settings in order to handle the links between the hordes
(how the messages are transfered) and it provides the mechanics for
spawning an horde for scalability (the same services exists in multiple
processes).
