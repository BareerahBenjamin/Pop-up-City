#include "network_commands.h"
#include <assert.h>
#include <stdio.h>
int main(void){for(int i=PC_NET_REFRESH;i<PC_NET_COMMAND_COUNT;i++)assert(pc_net_command_valid((pc_net_command_kind)i));assert(pc_net_command_valid(PC_NET_FRIEND_SHOWN));assert(!pc_net_command_valid((pc_net_command_kind)-1));assert(!pc_net_command_valid(PC_NET_COMMAND_COUNT));assert(!pc_net_command_valid((pc_net_command_kind)100));puts("Worker command range: all commands including code-visible acknowledgment accepted; invalid values rejected PASS");}
