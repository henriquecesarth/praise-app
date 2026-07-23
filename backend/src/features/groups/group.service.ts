import { GroupRepository } from '../../repositories/GroupRepository';
import { CreateGroupInput, CreateInviteInput, JoinGroupInput } from './group.types';

export class GroupService {
  constructor(private readonly groupRepository: GroupRepository = new GroupRepository()) {}

  /**
   * Listar todos os grupos em que o usuário é membro ou dono
   */
  async getUserGroups(userId: string) {
    return this.groupRepository.getUserGroups(userId);
  }

  /**
   * Obter detalhes de um grupo
   */
  async getGroupById(groupId: string, userId: string) {
    return this.groupRepository.getGroupById(groupId, userId);
  }

  /**
   * Criar um novo grupo de louvor
   */
  async createGroup(userId: string, input: CreateGroupInput) {
    return this.groupRepository.createGroup(userId, input.name, input.slug);
  }

  /**
   * Gerar um código curto de convite (ex: PR-8X2K)
   */
  async createInviteCode(groupId: string, userId: string, input: CreateInviteInput) {
    return this.groupRepository.createInviteCode(groupId, userId, input.expiresInDays, input.maxUses);
  }

  /**
   * Resgatar convite usando o código curto e entrar no grupo
   */
  async joinGroupByCode(userId: string, input: JoinGroupInput) {
    return this.groupRepository.joinGroupByCode(userId, input.code);
  }

  /**
   * Listar membros de um grupo
   */
  async getGroupMembers(groupId: string) {
    return this.groupRepository.getGroupMembers(groupId);
  }
}
