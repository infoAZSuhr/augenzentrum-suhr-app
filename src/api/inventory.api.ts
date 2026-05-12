import client from './client'
import type { InventoryArticle, InventoryLot, StockMovement, Order, InventoryAlert } from '../types/inventory.types'

export const inventoryApi = {
  listArticles: (params?: { category?: string; search?: string }) =>
    client.get<InventoryArticle[]>('/inventory/articles', { params }).then((r) => r.data),

  getArticle: (id: number) =>
    client.get<InventoryArticle & { lots: InventoryLot[]; movements: StockMovement[] }>(`/inventory/articles/${id}`).then((r) => r.data),

  createArticle: (data: Omit<InventoryArticle, 'id'>) =>
    client.post<InventoryArticle>('/inventory/articles', data).then((r) => r.data),

  updateArticle: (id: number, data: Partial<InventoryArticle>) =>
    client.put<InventoryArticle>(`/inventory/articles/${id}`, data).then((r) => r.data),

  addLot: (data: Omit<InventoryLot, 'id'>) =>
    client.post<InventoryLot>('/inventory/lots', data).then((r) => r.data),

  addMovement: (data: Omit<StockMovement, 'id'>) =>
    client.post<StockMovement>('/inventory/movements', data).then((r) => r.data),

  getAlerts: () =>
    client.get<InventoryAlert[]>('/inventory/alerts').then((r) => r.data),

  listOrders: () =>
    client.get<Order[]>('/inventory/orders').then((r) => r.data),

  createOrder: (data: Omit<Order, 'id'>) =>
    client.post<Order>('/inventory/orders', data).then((r) => r.data),

  updateOrder: (id: number, data: Partial<Order>) =>
    client.put<Order>(`/inventory/orders/${id}`, data).then((r) => r.data),
}
